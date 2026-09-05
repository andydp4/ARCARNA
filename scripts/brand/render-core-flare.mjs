#!/usr/bin/env node
/**
 * Render the Control Centre backdrop to video for marketing use.
 *
 * The animation is CSS, so there is nothing to capture in realtime. This
 * steps it frame by frame in headless Chromium via the design source's
 * seek helper — every frame lands exactly on its 1/fps slot and the
 * output is byte-deterministic across runs.
 *
 * Two clips come out of one render pass:
 *
 *   hero  0 -> 7900ms   the reveal, then one full breath
 *   loop  2700 -> 7900  the settled breath alone, seamless
 *
 * The loop is seamless by construction rather than by crossfade: past
 * 2700ms every one-shot animation is holding its final frame (they are
 * all `both`-filled and 2700ms long), so the only thing still moving is
 * the 5200ms pulse. Sampling exactly one pulse period and dropping the
 * end frame therefore closes the cycle exactly.
 *
 *   node scripts/brand/render-core-flare.mjs
 *   node scripts/brand/render-core-flare.mjs --clip loop --fps 60
 *
 * Requires ffmpeg on PATH and a Chromium the script can find.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const SOURCE = resolve(HERE, 'arcarna-core-flare.html');

// The design source is a 420px dashboard band. For video it has to fill a
// 16:9 frame instead, with the sphere on the centre line.
const FRAME_CSS = `
  html, body { height: 100%; }
  .stage { position: fixed; inset: 0; width: 100%; height: 100%; }
  .arc-cf { top: 50% !important; height: 0 !important; overflow: visible !important; }
`;

const CLIPS = {
  hero: { from: 0, to: 7900, dropLast: false },
  loop: { from: 2700, to: 7900, dropLast: true },
};

/**
 * Prefer a Chromium already on disk. CI images often ship a build that
 * predates the Playwright pin, and default resolution fails the
 * exact-revision check. Undefined lets Playwright resolve its own.
 */
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
    clip: 'both',
    fps: 30,
    // 768x432 is exactly 16:9 and multiplies cleanly to UHD at DPR 5. It
    // also happens to frame the sphere well: 260px of shell across 432px
    // of frame, with the halo running off the edges.
    cssWidth: 768,
    cssHeight: 432,
    dpr: 5,
    // Rasterising this many large blurred layers at UHD is fill-rate
    // bound, and Chromium already threads it — four pages measured only
    // 1.47x over one, so there is little point going wider than the box.
    workers: 4,
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
      case '--crf': args.crf = Number(take()); break;
      case '--keep-frames': args.keepFrames = true; break;
      case '--help': printUsage(); process.exit(0); break;
      default:
        if (flag.startsWith('--')) { console.error(`Unknown flag: ${flag}`); process.exit(2); }
    }
  }
  if (!['hero', 'loop', 'both'].includes(args.clip)) {
    console.error(`--clip must be hero, loop or both`); process.exit(2);
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/brand/render-core-flare.mjs [options]

  --out-dir DIR   where the files land (default dist/marketing)
  --clip NAME     hero | loop | both            (default both)
  --fps N         frame rate                    (default 30)
  --width N       CSS width; height follows     (default 768)
  --height N      CSS height                    (default 432)
  --dpr N         device pixel ratio            (default 5, so UHD)
  --workers N     parallel render pages         (default 4)
  --crf N         x264 quality, lower is better (default 16)
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

/** Render one clip's PNG sequence, sharing the work across pages. */
async function renderFrames(browser, { from, to, dropLast }, args, dir) {
  const span = to - from;
  let count = Math.round((span / 1000) * args.fps);
  const step = span / count;
  if (!dropLast) count += 1;   // hero includes its final frame

  const times = Array.from({ length: count }, (_, i) => from + i * step);
  const width = String(count - 1).length + 1;

  let done = 0;
  const startedAt = Date.now();
  const chunk = Math.ceil(count / args.workers);

  await Promise.all(Array.from({ length: args.workers }, async (_, w) => {
    const first = w * chunk;
    if (first >= count) return;
    const page = await browser.newPage({
      viewport: { width: args.cssWidth, height: args.cssHeight },
      deviceScaleFactor: args.dpr,
    });
    await page.goto(pathToFileURL(SOURCE).href, { waitUntil: 'load' });
    await page.addStyleTag({ content: FRAME_CSS });

    for (let i = first; i < Math.min(first + chunk, count); i++) {
      await page.evaluate((ms) => {
        window.ARCARNA_FLARE.seek(ms);
        // Two frames: one for the delay change to take, one to composite.
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, times[i]);
      await page.screenshot({ path: join(dir, `f${String(i).padStart(width, '0')}.png`), type: 'png' });
      done += 1;
      if (done % 10 === 0 || done === count) {
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
  const out = (suffix, ext) => join(args.outDir, `${name}${suffix}.${ext}`);

  // Tag colour explicitly. Untagged UHD gets guessed as BT.2020 by some
  // players, which shifts these blues noticeably.
  const TAG = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];
  const IN = ['-y', '-framerate', String(args.fps), '-i', pattern];

  const jobs = [
    ['UHD  H.264', [...IN, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(args.crf),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...TAG, out('-4k', 'mp4')]],
    ['UHD  VP9', [...IN, '-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-row-mt', '1',
      '-pix_fmt', 'yuv420p', ...TAG, out('-4k', 'webm')]],
    ['1080 H.264', [...IN, '-vf', `scale=${hd}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow',
      '-crf', String(args.crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...TAG, out('-1080', 'mp4')]],
    ['1080 VP9', [...IN, '-vf', `scale=${hd}:flags=lanczos`, '-c:v', 'libvpx-vp9', '-crf', '30',
      '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p', ...TAG, out('-1080', 'webm')]],
  ];
  for (const [label, cmd] of jobs) {
    process.stderr.write(`  ${label} ... `);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...cmd]);
    const f = cmd[cmd.length - 1];
    process.stderr.write(`${((await stat(f)).size / 1048576).toFixed(1)} MB\n`);
  }
  return px;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(SOURCE)) {
    console.error(`Missing ${SOURCE} — run scripts/brand/sync-core-flare.py first.`);
    process.exit(1);
  }
  await mkdir(args.outDir, { recursive: true });

  const executablePath = findChromium();
  const browser = await chromium.launch({
    executablePath,
    // Pin the colour profile; the default varies with the host and shifts
    // these blues between machines.
    args: ['--force-color-profile=srgb', '--hide-scrollbars'],
  });

  const names = args.clip === 'both' ? ['hero', 'loop'] : [args.clip];
  for (const name of names) {
    const clip = CLIPS[name];
    const outName = `arcarna-core-flare-${name}`;
    const frameDir = join(args.outDir, `.frames-${name}`);
    await rm(frameDir, { recursive: true, force: true });
    await mkdir(frameDir, { recursive: true });

    console.error(`\n=== ${name}: ${clip.from}-${clip.to}ms at ${args.fps}fps ===`);
    const { count, width } = await renderFrames(browser, clip, args, frameDir);
    const px = await encode(frameDir, width, args, outName);

    // Poster: the burst for the hero, the settled sphere for the loop.
    const posterAt = name === 'hero' ? 1404 : 5300;
    const idx = Math.round(((posterAt - clip.from) / 1000) * args.fps);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-i', join(frameDir, `f${String(Math.min(idx, count - 1)).padStart(width, '0')}.png`),
      '-q:v', '2', join(args.outDir, `${outName}-poster.jpg`)]);

    console.error(`  poster at ${posterAt}ms  ·  ${count} frames  ·  ${px}`);
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
