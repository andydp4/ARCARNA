#!/usr/bin/env node
/**
 * Render scripts/brand/arcarna-light-spheres.html to video.
 *
 * Drives the animation frame by frame in headless Chromium — no realtime
 * capture — so the output is deterministic and every frame lands exactly
 * on its 1/fps slot. Frames are piped straight into ffmpeg, so a 1080p
 * loop never touches disk as intermediate PNGs.
 *
 *   node scripts/brand/render-brand-loop.mjs
 *   node scripts/brand/render-brand-loop.mjs --out-dir /tmp/preview --scale 0.5
 *
 * Requires ffmpeg on PATH and the repo's Playwright Chromium.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const SOURCE = resolve(HERE, 'arcarna-light-spheres.html');

/**
 * Prefer a Chromium that is actually on disk. CI images often ship a
 * browser build that predates the Playwright version in package.json,
 * and the default resolution would fail on the exact-revision check.
 * Returns undefined to let Playwright resolve its own download.
 */
function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/opt/pw-browsers/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

function parseArgs(argv) {
  const args = {
    outDir: resolve(REPO, 'client/public/brand/motion'),
    name: 'arcarna-light-spheres',
    // Render resolution. Height follows at 16:9.
    width: 3840,
    scale: 1,
    crf: 18,
    // Frame 96: the floor chains converge into a road under the risers.
    posterFrame: 96,
    webm: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inlineValue] = argv[i].split('=');
    const value = inlineValue ?? argv[i + 1];
    const consume = () => { if (inlineValue === undefined) i++; };
    switch (flag) {
      case '--out-dir': args.outDir = resolve(process.cwd(), value); consume(); break;
      case '--name': args.name = value; consume(); break;
      case '--width': args.width = Number(value); consume(); break;
      case '--scale': args.scale = Number(value); consume(); break;
      case '--crf': args.crf = Number(value); consume(); break;
      case '--poster-frame': args.posterFrame = Number(value); consume(); break;
      case '--no-webm': args.webm = false; break;
      default:
        if (flag.startsWith('--')) throw new Error(`Unknown flag: ${flag}`);
    }
  }
  if (!(args.scale > 0 && args.scale <= 1)) throw new Error('--scale must be in (0, 1]');
  if (!Number.isFinite(args.width) || args.width < 320) throw new Error('--width must be >= 320');
  return args;
}

/** Spawn ffmpeg reading a PNG stream on stdin, and resolve when it exits. */
function startEncoder(outPath, fps, extraArgs) {
  const ff = spawn('ffmpeg', [
    '-y',
    '-loglevel', 'error',
    '-f', 'image2pipe',
    '-framerate', String(fps),
    '-i', '-',
    ...extraArgs,
    outPath,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const encoder = { ff, failure: null };
  encoder.done = new Promise((resolvePromise, rejectPromise) => {
    const fail = (err) => { encoder.failure = err; rejectPromise(err); };
    ff.on('error', fail);
    ff.on('close', (code) => {
      if (code === 0) resolvePromise();
      else fail(new Error(`ffmpeg exited ${code} while writing ${outPath}`));
    });
  });
  /* Once ffmpeg is gone every write raises EPIPE. Swallow it here — the
   * close/error handler above is what reports the real reason, and the
   * render loop checks `failure` so it stops rather than spending
   * several minutes piping frames into a dead pipe. */
  encoder.done.catch(() => {});
  ff.stdin.on('error', () => {});
  return encoder;
}

/** Backpressure-aware write. */
function writeFrame(stream, buffer) {
  if (stream.write(buffer)) return Promise.resolve();
  return new Promise((resolvePromise) => stream.once('drain', resolvePromise));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outDir, { recursive: true });

  const executablePath = findChromium();
  if (executablePath) console.log(`Chromium: ${executablePath}`);
  const browser = await chromium.launch({
    executablePath,
    args: ['--force-color-profile=srgb', '--disable-lcd-text'],
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  /* Record rather than throw: throwing from an event handler escapes the
   * promise chain and orphans the browser process. */
  let pageError = null;
  page.on('pageerror', (err) => { pageError ??= err; });

  await page.addInitScript((width) => {
    window.__ARCARNA_HEADLESS__ = true;
    window.__ARCARNA_WIDTH__ = width;
  }, args.width);
  await page.goto(pathToFileURL(SOURCE).href, { waitUntil: 'load' });

  const config = await page.evaluate(() => window.ARCARNA_LOOP.CONFIG);
  const outW = Math.round(config.width * args.scale / 2) * 2;
  const outH = Math.round(config.height * args.scale / 2) * 2;

  console.log(
    `Rendering ${config.frameCount} frames · ${outW}×${outH} · ${config.fps}fps · ` +
    `${config.durationSeconds}s seamless loop`,
  );

  const mp4Path = resolve(args.outDir, `${args.name}.mp4`);
  const webmPath = resolve(args.outDir, `${args.name}.webm`);
  const posterPath = resolve(args.outDir, `${args.name}-poster.jpg`);

  const scaleFilter = args.scale === 1 ? [] : ['-vf', `scale=${outW}:${outH}:flags=lanczos`];
  const mp4 = startEncoder(mp4Path, config.fps, [
    ...scaleFilter,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', String(args.crf),
    '-pix_fmt', 'yuv420p',
    // Closed GOP on the loop boundary so players restart cleanly.
    '-g', String(config.frameCount),
    '-movflags', '+faststart',
    '-an',
  ]);
  const webm = args.webm
    ? startEncoder(webmPath, config.fps, [
      ...scaleFilter,
      '-c:v', 'libvpx-vp9',
      '-b:v', '0',
      '-crf', '34',
      '-row-mt', '1',
      '-pix_fmt', 'yuv420p',
      '-an',
    ])
    : null;

  const started = Date.now();
  for (let frame = 0; frame < config.frameCount; frame++) {
    if (mp4.failure) throw mp4.failure;
    if (webm?.failure) throw webm.failure;
    if (pageError) throw pageError;

    const dataUrl = await page.evaluate((i) => {
      window.ARCARNA_LOOP.renderFrame(i);
      return document.getElementById('stage').toDataURL('image/png');
    }, frame);

    const png = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
    await writeFrame(mp4.ff.stdin, png);
    if (webm) await writeFrame(webm.ff.stdin, png);

    if (frame === args.posterFrame) {
      await new Promise((res, rej) => {
        const still = spawn('ffmpeg', [
          '-y', '-loglevel', 'error', '-f', 'image2pipe', '-i', '-',
          ...(args.scale === 1 ? [] : ['-vf', `scale=${outW}:${outH}:flags=lanczos`]),
          '-q:v', '3', posterPath,
        ], { stdio: ['pipe', 'inherit', 'inherit'] });
        still.on('close', (c) => (c === 0 ? res() : rej(new Error(`poster ffmpeg exited ${c}`))));
        still.on('error', rej);
        still.stdin.end(png);
      });
    }

    if (frame % 30 === 29 || frame === config.frameCount - 1) {
      const pct = Math.round(((frame + 1) / config.frameCount) * 100);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`  ${String(frame + 1).padStart(3)}/${config.frameCount} frames (${pct}%) · ${secs}s`);
    }
  }

  mp4.ff.stdin.end();
  if (webm) webm.ff.stdin.end();
  await mp4.done;
  if (webm) await webm.done;
  await browser.close();

  for (const p of [mp4Path, webmPath, posterPath]) {
    try {
      const s = await stat(p);
      console.log(`  ${p.replace(`${REPO}/`, '')} — ${(s.size / 1024 / 1024).toFixed(2)} MB`);
    } catch { /* webm skipped */ }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
