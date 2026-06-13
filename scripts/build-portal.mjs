import fs from "node:fs";
import path from "node:path";

const src = path.resolve("portal");
const dest = path.resolve("dist/portal");
const brandSrc = path.resolve("client/public/brand/arcarna-wordmark.png");
const brandDest = path.resolve("portal/portal-assets/arcarna-wordmark.png");

if (!fs.existsSync(src)) {
  console.error("portal/ directory not found");
  process.exit(1);
}

if (fs.existsSync(brandSrc)) {
  fs.mkdirSync(path.dirname(brandDest), { recursive: true });
  fs.copyFileSync(brandSrc, brandDest);
}

fs.cpSync(src, dest, { recursive: true });
console.log(`[build:portal] Copied ${src} → ${dest}`);
