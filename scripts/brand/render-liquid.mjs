#!/usr/bin/env node
/**
 * Render the ARCARNA liquid cuts to video for marketing use.
 *
 * The liquid is a WebGL shader, so there is nothing to capture in
 * realtime and nothing to record. This steps the page frame by frame
 * through its own seek helper: every frame lands exactly on its 1/fps
 * slot and the output is byte-deterministic across runs.
 *
 * Three cuts come out of scripts/brand/arcarna-liquid.html:
 *
 *   mark      0 -> 4400ms   the a revealing itself, then the wordmark
 *   endcard   0 -> 8600     mark, wordmark, spin-out, by viger cloud
 *   backdrop  0 -> 12000    the Control Centre ground, no mark
 *   marksolo  0 -> 5000     the mark alone, no wordmark. Loops.
 *   cloud     0 -> 8600     the mark, a five second hold, then viger cloud
 *
 * Determinism is not incidental — it is what makes the sequence hold
 * together. Two things in the page had to be put on the timeline for
 * it: the liquid's own clock, and the film grain, which used to run
 * off a free timer and made every seek() land on a different grain
 * frame. Both now derive from the seek position, so consecutive
 * frames are consecutive and a re-render matches the first one.
 *
 *   node scripts/brand/render-liquid.mjs
 *   node scripts/brand/render-liquid.mjs --clip endcard --fps 60
 *
 * Requires ffmpeg on PATH and a Chromium the script can find. A real
 * GPU makes this minutes rather than tens of minutes; headless CI
 * falls back to SwiftShader, which renders correctly but slowly.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const SOURCE = resolve(HERE, 'arcarna-liquid.html');

// Each `to` is the cut's own length from CUTS in arcarna-liquid.html and
// has to stay in step with it. The two looping cuts are 24000 — two turns
// of LIQUID_PERIOD — so the last frame joins the first with no crossfade;
// shortening either one to a nicer number puts a jump in the seam.
// Posters land on the beat the clip is about, not on its final frame.
const CLIPS = {
  mark:     { mode: 'mark',     from: 0, to: 24000, poster: 16800 },
  endcard:  { mode: 'endcard',  from: 0, to: 21000, poster: 20600 },
  backdrop: { mode: 'backdrop', from: 0, to: 12000, poster: 6000 },
  // The a alone: rises, drains, goes white, returns. Loops.
  marksolo: { mode: 'markSolo', from: 0, to: 24000, poster: 14600 },
  // The a, a five second hold, then by viger cloud.
  cloud:    { mode: 'cloud',    from: 0, to: 21000, poster: 20500 },
};

function findChromium() {
  return [
    process.env.CHROMIUM_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/opt/pw-browsers/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean).find((p) => existsSync(p));
}

function parseArgs(argv) {
  const args = {
    outDir: resolve(REPO, 'dist/marketing'),
    clip: 'all',
    fps: 30,
    // 1280x720 at DPR 3 is exactly UHD and exactly 16:9. It also frames
    // the mark well: 528px of letterform across 720px of height.
    cssWidth: 1280,
    cssHeight: 720,
    dpr: 3,
    workers: 3,
    // Playwright's screenshot default is 30s. A 4K frame off SwiftShader,
    // with several workers contending for the same cores, goes past that —
    // the render dies mid-clip with a TimeoutError after having spent the
    // frames it already rendered. The wait is legitimate work, not a hang,
    // so give it room rather than racing it.
    shotTimeout: 120000,
    crf: 16,
    keepFrames: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=');
    const value = inline ?? argv[i + 1];
    const take = () => { if (inline === undefined) i++; return value; };
    switch (flag) {
      case '--out-dir': args.outDir = resolve(take()); break;
      case '--clip': args.clip = take(); break;
      case '--fps': args.fps = Number(take()); break;
      case '--width': args.cssWidth = Number(take()); break;
      case '--height': args.cssHeight = Number(take()); break;
      case '--dpr': args.dpr = Number(take()); break;
      case '--workers': args.workers = Number(take()); break;
      case '--timeout': args.shotTimeout = Number(take()); break;
      case '--crf': args.crf = Number(take()); break;
      case '--keep-frames': args.keepFrames = true; break;
      case '--help': printUsage(); process.exit(0); break;
      default:
        if (flag.startsWith('--')) { console.error(`Unknown flag: ${flag}`); process.exit(2); }
    }
  }
  if (args.clip !== 'all' && !CLIPS[args.clip]) {
    console.error(`--clip must be one of: ${Object.keys(CLIPS).join(', ')}, all`);
    process.exit(2);
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/brand/render-liquid.mjs [options]

  --out-dir DIR   where the files land (default dist/marketing)
  --clip NAME     mark | endcard | backdrop | all   (default all)
  --fps N         frame rate                        (default 30)
  --width N       CSS width                         (default 1280)
  --height N      CSS height                        (default 720)
  --dpr N         device pixel ratio                (default 3, so UHD)
  --workers N     parallel render pages             (default 3)
  --timeout MS    per-frame screenshot cap          (default 120000)
  --crf N         x264 quality, lower is better     (default 16)
  --keep-frames   leave the PNG sequence behind`);
}

function run(cmd, cmdArgs) {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', fail);
    child.on('close', (code) => code === 0
      ? ok()
      : fail(new Error(`${cmd} exited ${code}\n${err.split('\n').slice(-25).join('\n')}`)));
  });
}

async function openPage(browser, args, mode) {
  const page = await browser.newPage({
    viewport: { width: args.cssWidth, height: args.cssHeight },
    deviceScaleFactor: args.dpr,
  });
  await page.goto(`${pathToFileURL(SOURCE).href}?bare=1&mode=${mode}`, { waitUntil: 'load' });
  // The shader compiles and the grain frames are built on first paint;
  // grabbing before that yields an empty or half-built frame.
  await page.waitForFunction(() => !!window.ARCARNA_LIQUID);
  const ok = await page.evaluate(() => document.getElementById('page').dataset.gl !== 'off');
  if (!ok) throw new Error('WebGL unavailable in this browser — the liquid cannot render.');
  await page.waitForTimeout(500);
  return page;
}

async function renderFrames(browser, clip, args, dir) {
  const count = Math.round(((clip.to - clip.from) / 1000) * args.fps);
  const step = (clip.to - clip.from) / count;
  const times = Array.from({ length: count }, (_, i) => clip.from + i * step);
  const width = String(count - 1).length + 1;

  let done = 0;
  const startedAt = Date.now();
  const chunk = Math.ceil(count / args.workers);

  await Promise.all(Array.from({ length: args.workers }, async (_, w) => {
    const first = w * chunk;
    if (first >= count) return;
    const page = await openPage(browser, args, clip.mode);
    for (let i = first; i < Math.min(first + chunk, count); i++) {
      const file = join(dir, `f${String(i).padStart(width, '0')}.png`);
      // Frames already on disk are reused, so a clip that dies part-way can
      // be resumed with --keep-frames instead of started over.
      if (existsSync(file)) { done += 1; continue; }
      await page.evaluate((ms) => {
        window.ARCARNA_LIQUID.seek(ms);
        // Two frames: one for the seek to take, one to composite.
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, times[i]);
      await page.screenshot({ path: file, type: 'png', timeout: args.shotTimeout });
      done += 1;
      if (done % 5 === 0 || done === count) {
        const per = (Date.now() - startedAt) / done;
        const left = ((count - done) * per) / 1000;
        process.stderr.write(`\r  ${done}/${count} frames  ${(per / 1000).toFixed(2)}s/frame  ~${left.toFixed(0)}s left   `);
      }
    }
    await page.close();
  }));
  process.stderr.write('\n');
  return { count, width };
}

async function encode(dir, width, args, name) {
  const pattern = join(dir, `f%0${width}d.png`);
  const px = `${args.cssWidth * args.dpr}x${args.cssHeight * args.dpr}`;
  const hd = `${Math.round(args.cssWidth * args.dpr / 2)}x${Math.round(args.cssHeight * args.dpr / 2)}`;
  // Name by the height actually rendered, not by assuming --dpr 3. At the
  // default that is 2160 and 1080, so the filenames are unchanged; at any
  // other dpr the old hardcoded -4k was simply a lie about the contents.
  const tall = args.cssHeight * args.dpr;
  const tag = (h) => (h >= 2000 ? '-4k' : `-${h}`);
  const full = tag(tall), half = tag(Math.round(tall / 2));
  const out = (suffix, ext) => join(args.outDir, `${name}${suffix}.${ext}`);

  // Tag colour explicitly. Untagged UHD gets guessed as BT.2020 by some
  // players, which shifts these blues noticeably.
  const TAG = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];
  const IN = ['-y', '-framerate', String(args.fps), '-i', pattern];

  const jobs = [
    [`${full.slice(1).padEnd(4)} H.264`, [...IN, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(args.crf),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...TAG, out(full, 'mp4')]],
    [`${full.slice(1).padEnd(4)} VP9`, [...IN, '-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-row-mt', '1',
      '-pix_fmt', 'yuv420p', ...TAG, out(full, 'webm')]],
    [`${half.slice(1).padEnd(4)} H.264`, [...IN, '-vf', `scale=${hd}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow',
      '-crf', String(args.crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...TAG, out(half, 'mp4')]],
    [`${half.slice(1).padEnd(4)} VP9`, [...IN, '-vf', `scale=${hd}:flags=lanczos`, '-c:v', 'libvpx-vp9', '-crf', '30',
      '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p', ...TAG, out(half, 'webm')]],
  ];
  for (const [label, cmd] of jobs) {
    process.stderr.write(`  ${label} ... `);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...cmd]);
    process.stderr.write(`${((await stat(cmd[cmd.length - 1])).size / 1048576).toFixed(1)} MB\n`);
  }
  return px;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(SOURCE)) {
    console.error(`Missing ${SOURCE}`);
    process.exit(1);
  }
  await mkdir(args.outDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: [
      // Headless has no GPU; without these WebGL is simply absent and the
      // page falls back to its still ground, which is not what we want in
      // a video. SwiftShader is slow but correct.
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--force-color-profile=srgb',
      '--hide-scrollbars',
    ],
  });

  const names = args.clip === 'all' ? Object.keys(CLIPS) : [args.clip];
  for (const name of names) {
    const clip = CLIPS[name];
    const outName = `arcarna-liquid-${name}`;
    const frameDir = join(args.outDir, `.frames-${name}`);
    if (!args.keepFrames) await rm(frameDir, { recursive: true, force: true });
    await mkdir(frameDir, { recursive: true });

    console.error(`\n=== ${name}: ${clip.from}-${clip.to}ms at ${args.fps}fps ===`);
    const { count, width } = await renderFrames(browser, clip, args, frameDir);
    const px = await encode(frameDir, width, args, outName);

    const idx = Math.min(Math.round((clip.poster / 1000) * args.fps), count - 1);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-i', join(frameDir, `f${String(idx).padStart(width, '0')}.png`),
      '-q:v', '2', join(args.outDir, `${outName}-poster.jpg`)]);

    console.error(`  poster at ${clip.poster}ms  ·  ${count} frames  ·  ${px}`);
    if (!args.keepFrames) await rm(frameDir, { recursive: true, force: true });
  }

  await browser.close();
  const files = (await readdir(args.outDir)).filter((f) => !f.startsWith('.')).sort();
  console.error(`\nWrote ${files.length} files to ${args.outDir}:`);
  for (const f of files) {
    console.error(`  ${f}  ${((await stat(join(args.outDir, f))).size / 1048576).toFixed(1)} MB`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
