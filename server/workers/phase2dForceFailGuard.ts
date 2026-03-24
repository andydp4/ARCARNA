/**
 * Phase 2D test-only failure hook. Must never activate when NODE_ENV=production.
 * This module must stay free of ../db (and any DATABASE_URL side effects) so
 * scripts/assert-production-hooks-off.ts can run in check-only gate mode.
 */
export function assertPhase2dForceFailGuard(payload: {
  _phase2dForceFail?: boolean;
}): void {
  const allowForceFail =
    process.env.PHASE2D_TEST === "1" &&
    process.env.NODE_ENV !== "production" &&
    payload._phase2dForceFail === true;
  if (allowForceFail) {
    throw new Error("Phase2D: Intentional worker failure for dead-letter test");
  }
}
