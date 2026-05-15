/**
 * Explicit runtime auth flags — single source of truth for bypass and dev tooling.
 * DEV_AUTH_BYPASS must be set explicitly; NODE_ENV alone does not enable bypass.
 */
export function isDevAuthBypassEnabled(): boolean {
  return (
    process.env.DEV_AUTH_BYPASS === "1" &&
    process.env.NODE_ENV !== "production"
  );
}

export function getAuthRuntimeSnapshot() {
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    devAuthBypass: isDevAuthBypassEnabled(),
    devAuthBypassRequested: process.env.DEV_AUTH_BYPASS === "1",
    phase2dTest: process.env.PHASE2D_TEST === "1",
  };
}
