export type AuthProviderName = "clerk" | "replit";

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

/** Production default: Clerk. Set AUTH_PROVIDER=replit for legacy rollback. */
export function getAuthProvider(): AuthProviderName {
  const raw = (process.env.AUTH_PROVIDER ?? "clerk").toLowerCase();
  return raw === "replit" ? "replit" : "clerk";
}

export function getAuthRuntimeSnapshot() {
  const provider = getAuthProvider();
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    authProvider: provider,
    devAuthBypass: isDevAuthBypassEnabled(),
    devAuthBypassRequested: process.env.DEV_AUTH_BYPASS === "1",
    phase2dTest: process.env.PHASE2D_TEST === "1",
    clerkPublishableKey:
      provider === "clerk"
        ? process.env.CLERK_PUBLISHABLE_KEY ??
          process.env.VITE_CLERK_PUBLISHABLE_KEY ??
          null
        : null,
  };
}
