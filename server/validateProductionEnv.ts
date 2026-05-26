import { getAuthProvider, isDevAuthBypassEnabled } from "./authRuntime";

/**
 * Fail fast on missing or unsafe production configuration.
 */
export function validateProductionEnv(): void {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const isProd = nodeEnv === "production";

  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required");
  }

  if (isProd) {
    if (!process.env.SESSION_SECRET?.trim()) {
      throw new Error("SESSION_SECRET is required when NODE_ENV=production");
    }
    if (process.env.SESSION_SECRET.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters in production");
    }
    if (isDevAuthBypassEnabled()) {
      throw new Error("DEV_AUTH_BYPASS cannot be enabled when NODE_ENV=production");
    }
    if (process.env.DEV_AUTH_BYPASS === "1") {
      throw new Error("DEV_AUTH_BYPASS=1 is not allowed in production (unset or use 0)");
    }
    if (process.env.PHASE2D_TEST === "1") {
      console.warn("[production] PHASE2D_TEST=1 is set — test hooks must remain disabled in production");
    }

    const provider = getAuthProvider();
    if (provider === "clerk") {
      if (!process.env.CLERK_SECRET_KEY?.trim()) {
        throw new Error("CLERK_SECRET_KEY is required when AUTH_PROVIDER=clerk in production");
      }
      const publishableKey =
        process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
        process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
      if (!publishableKey) {
        throw new Error(
          "CLERK_PUBLISHABLE_KEY or VITE_CLERK_PUBLISHABLE_KEY is required when AUTH_PROVIDER=clerk in production",
        );
      }
      if (!publishableKey.startsWith("pk_")) {
        throw new Error(
          "Clerk publishable key must start with pk_ (check CLERK_PUBLISHABLE_KEY / VITE_CLERK_PUBLISHABLE_KEY)",
        );
      }
      if (!process.env.CLERK_ACCOUNTS_URL?.trim()) {
        throw new Error(
          "CLERK_ACCOUNTS_URL is required in production (e.g. https://accounts.viger.cloud)",
        );
      }
    } else if (!process.env.REPL_ID?.trim()) {
      throw new Error("REPL_ID is required when AUTH_PROVIDER=replit in production");
    }
  }
}
