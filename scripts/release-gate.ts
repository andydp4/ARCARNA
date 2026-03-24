#!/usr/bin/env npx tsx
/**
 * Phase 2E Release Gate
 *
 * Runs in order:
 * 1. npm run check (TypeScript)
 * 2. Phase 2D seed + tests (if DATABASE_URL set)
 *
 * Exits non-zero on any failure. Prints a readable summary.
 */
import { execSync, spawnSync } from "child_process";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const cwd = process.cwd();
const hasDb = !!process.env.DATABASE_URL;

function run(
  cmd: string,
  opts?: { env?: Record<string, string> }
): { ok: boolean; out: string } {
  try {
    const result = spawnSync(cmd, {
      shell: true,
      cwd,
      stdio: ["inherit", "pipe", "pipe"],
      env: { ...process.env, PHASE2D_TEST: "1", NODE_ENV: "development", ...opts?.env },
    });
    const out = [result.stdout, result.stderr].filter(Boolean).join("\n");
    return { ok: result.status === 0, out };
  } catch (e) {
    return { ok: false, out: String(e) };
  }
}

async function main() {
  const failures: string[] = [];

  console.log("\n=== Phase 2E Release Gate ===\n");

  // 1. TypeScript check
  console.log("[1/4] Running npm run check...");
  const check = run("npm run check");
  if (!check.ok) {
    failures.push("TypeScript check failed");
    console.error(check.out || "tsc reported errors");
  } else {
    console.log("  ✓ TypeScript check passed\n");
  }

  // 2. Production hooks check (test hooks must stay OFF when NODE_ENV=production)
  console.log("[2/4] Asserting test hooks off in production...");
  const hooksCheck = run(
    "npx tsx scripts/assert-production-hooks-off.ts",
    { env: { ...process.env, NODE_ENV: "production", PHASE2D_TEST: "1" } }
  );
  if (!hooksCheck.ok) {
    failures.push("Production hooks check failed");
    console.error(hooksCheck.out || "Test hooks incorrectly active in production");
  } else {
    console.log("  ✓ Production hooks check passed\n");
  }

  if (!hasDb) {
    console.log("[3/4] Skipping Phase 2D seed (DATABASE_URL not set)");
    console.log("[4/4] Skipping Phase 2D tests (DATABASE_URL not set)");
    console.log("\n  Set DATABASE_URL to run full multi-org isolation validation.");
    console.log("  Gate considers check-only run as pass if TypeScript succeeds.\n");
    if (failures.length > 0) {
      console.log("=== FAILED ===");
      failures.forEach((f) => console.log("  -", f));
      process.exit(1);
    }
    console.log("=== Gate passed (check only) ===\n");
    process.exit(0);
  }

  // 3. Phase 2D seed
  console.log("[3/4] Running Phase 2D seed...");
  let seedJson: string;
  try {
    const out = execSync("npx tsx scripts/phase2d-seed.ts 2>&1", {
      cwd,
      encoding: "utf-8",
      env: { ...process.env, PHASE2D_TEST: "1", NODE_ENV: "development" },
    });
    const match = out.match(/\{[\s\S]*\}/);
    seedJson = match ? match[0] : "";
    if (!seedJson.startsWith("{")) {
      throw new Error("Seed did not output valid JSON");
    }
    console.log("  ✓ Seed completed\n");
  } catch (e) {
    failures.push("Phase 2D seed failed");
    console.error("  Error:", e instanceof Error ? e.message : String(e));
  }

  if (failures.length > 0) {
    console.log("\n=== FAILED ===");
    failures.forEach((f) => console.log("  -", f));
    process.exit(1);
  }

  // 4. Phase 2D tests (storage-only - no server required)
  console.log("[4/4] Running Phase 2D tests (storage + analytics + workers)...");
  const tmpDir = mkdtempSync(join(tmpdir(), "phase2d-"));
  const seedPath = join(tmpDir, "seed.json");
  writeFileSync(seedPath, seedJson, "utf-8");
  const testResult = run(`npx tsx scripts/phase2d-test.ts --storage-only "${seedPath}"`);
  if (!testResult.ok) {
    failures.push("Phase 2D tests failed");
    console.error(testResult.out || "Tests reported failures");
  } else {
    console.log("  ✓ Phase 2D tests passed\n");
  }

  if (failures.length > 0) {
    console.log("\n=== FAILED ===");
    failures.forEach((f) => console.log("  -", f));
    process.exit(1);
  }

  console.log("=== Gate passed ===\n");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
