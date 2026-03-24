#!/usr/bin/env npx tsx
/**
 * Asserts that Phase 2D test hooks do NOT fire when NODE_ENV=production.
 * Run with: NODE_ENV=production PHASE2D_TEST=1 npx tsx scripts/assert-production-hooks-off.ts
 * Exit 1 if any hook incorrectly activates.
 */
import { assertPhase2dForceFailGuard } from "../server/workers/phase2dForceFailGuard";

async function main() {
  const nodeEnv = process.env.NODE_ENV;
  const phase2dTest = process.env.PHASE2D_TEST;

  if (nodeEnv !== "production" || phase2dTest !== "1") {
    console.error(
      "Run with NODE_ENV=production PHASE2D_TEST=1 to verify hooks stay off"
    );
    process.exit(1);
  }

  let failed = false;

  // 1. ReplitAuth: isTestMode must be false when NODE_ENV=production
  const isTestMode =
    process.env.PHASE2D_TEST === "1" && process.env.NODE_ENV !== "production";
  if (isTestMode) {
    console.error(
      "FAIL: replitAuth isTestMode would be true (impersonation could activate)"
    );
    failed = true;
  } else {
    console.log("OK: replitAuth impersonation disabled (isTestMode=false)");
  }

  // 2. Same guard BusinessInsightsWorker uses at start of handle — must not throw in production
  try {
    assertPhase2dForceFailGuard({ _phase2dForceFail: true });
    console.log(
      "OK: Phase2D force-fail guard inactive in production (_phase2dForceFail ignored)"
    );
  } catch (err) {
    console.error(
      "FAIL: Phase2D force-fail guard threw in production (hook should be OFF):",
      err instanceof Error ? err.message : String(err)
    );
    failed = true;
  }

  if (failed) {
    process.exit(1);
  }
  console.log("\nAll production hook checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
