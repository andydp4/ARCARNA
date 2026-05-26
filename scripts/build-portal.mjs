import fs from "node:fs";
import path from "node:path";

const src = path.resolve("portal");
const dest = path.resolve("dist/portal");

if (!fs.existsSync(src)) {
  console.error("portal/ directory not found");
  process.exit(1);
}

fs.cpSync(src, dest, { recursive: true });
console.log(`[build:portal] Copied ${src} → ${dest}`);
