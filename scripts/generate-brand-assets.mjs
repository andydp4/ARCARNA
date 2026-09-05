#!/usr/bin/env node
/**
 * Regenerate every ARCARNA brand raster from the vector masters.
 *
 * The masters live in scripts/brand/ and are the files the brand owner
 * supplies. Everything under client/public/ and docs/training/images/ is
 * derived, so a logo change is one re-run rather than a hunt for every
 * PNG in the tree.
 *
 *   node scripts/generate-brand-assets.mjs
 *   node scripts/generate-brand-assets.mjs --check    # fail if stale
 *
 * Replaces the previous Python/Pillow version. The rest of the brand
 * tooling here already drives headless Chromium (render-liquid.mjs,
 * render-core-flare.mjs), so this uses the same renderer rather than
 * adding Pillow as a second image stack — and unlike Pillow it can
 * rasterise the SVG masters directly instead of resampling a PNG that
 * was itself a resample.
 *
 * The mark is deliberately BARE — Truth Blue on transparent, no tile.
 * The previous icons put a white glyph on a dark rounded tile, which is
 * what made them legible on any ground; dropping it is a deliberate
 * brand decision, not an oversight. The trade-off it accepts: at 32px
 * on a Truth Blue ground the mark is nearly invisible, since it is the
 * same colour. If that shows up somewhere it matters, the fix is a
 * tiled variant for icons only, not a change to the master.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

/** Vector masters, as supplied. */
const MARK_MASTER = join(HERE, 'brand/arcarna-mark_Master-Logo.svg');
const WORDMARK_MASTER = join(HERE, 'brand/arcarna-mark_Master-Wordmark.png');

/** Square renders of the mark. Width and height are equal. */
const MARK_OUTPUTS = [
  ['client/public/brand/arcarna-mark.png', 1024],
  ['docs/training/images/brand/arcarna-mark.png', 1024],
  ['client/public/logo.png', 256],
  ['client/public/icon-512.png', 512],
  ['client/public/icon-192.png', 192],
  ['client/public/favicon-32.png', 32],
];

/** Wordmark renders. Height follows the master's own aspect ratio — it
 *  carries the "reveal your truth" line now, so it is taller relative to
 *  its width than the wordmark it replaces. Forcing the old 4688x1046
 *  box would squash it. */
const WORDMARK_OUTPUTS = [
  ['client/public/brand/arcarna-wordmark.png', 4688],
  ['docs/training/images/brand/arcarna-wordmark.png', 4688],
];

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

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);

async function main() {
  const check = process.argv.includes('--check');
  for (const f of [MARK_MASTER, WORDMARK_MASTER]) {
    if (!existsSync(f)) {
      console.error(`Missing master: ${relative(REPO, f)}`);
      process.exit(1);
    }
  }

  const markSvg = (await readFile(MARK_MASTER, 'utf8')).replace(/<\?xml[^>]*\?>/, '');
  const wordmarkData =
    `data:image/png;base64,${(await readFile(WORDMARK_MASTER)).toString('base64')}`;

  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--force-color-profile=srgb', '--hide-scrollbars'],
  });

  const stale = [];
  const write = async (relPath, buf) => {
    const dest = join(REPO, relPath);
    const before = existsSync(dest) ? sha(await readFile(dest)) : null;
    const after = sha(buf);
    if (before === after) { console.log(`  unchanged  ${relPath}`); return; }
    if (check) { stale.push(relPath); console.log(`  STALE      ${relPath}`); return; }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    console.log(`  wrote      ${relPath}`);
  };

  // --- the mark, from the SVG master -----------------------------------
  console.log(`mark  <- ${relative(REPO, MARK_MASTER)}`);
  for (const [relPath, size] of MARK_OUTPUTS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}
       svg{display:block;width:${size}px;height:${size}px}</style>${markSvg}`);
    // omitBackground keeps the transparency — the mark is bare by design.
    await write(relPath, await page.screenshot({ omitBackground: true }));
    await page.close();
  }

  // --- the wordmark, from the PNG master --------------------------------
  console.log(`wordmark  <- ${relative(REPO, WORDMARK_MASTER)}`);
  const probe = await browser.newPage();
  await probe.setContent(`<img id="w" src="${wordmarkData}">`);
  const { w, h } = await probe.evaluate(() => new Promise((r) => {
    const img = document.getElementById('w');
    const done = () => r({ w: img.naturalWidth, h: img.naturalHeight });
    img.complete ? done() : (img.onload = done);
  }));
  await probe.close();
  console.log(`  master is ${w}x${h} (${(w / h).toFixed(2)}:1)`);

  for (const [relPath, width] of WORDMARK_OUTPUTS) {
    const height = Math.round(width * (h / w));
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}
       img{display:block;width:${width}px;height:${height}px}</style>
       <img src="${wordmarkData}">`);
    await write(relPath, await page.screenshot({ omitBackground: true }));
    await page.close();
  }

  await browser.close();

  if (check && stale.length) {
    console.error(`\n${stale.length} asset(s) do not match the masters. Run without --check.`);
    process.exit(1);
  }
  console.log(check ? '\nall assets match the masters' : '\ndone');
}

main().catch((e) => { console.error(e); process.exit(1); });
