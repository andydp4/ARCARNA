export type AuthRuntime = {
  authProvider?: "clerk" | "replit";
  clerkPublishableKey?: string | null;
  clerkAccountsUrl?: string | null;
  devAuthBypass?: boolean;
};

/** Publishable key: build-time Vite env first, then runtime API. */
export function resolveClerkPublishableKey(runtime?: AuthRuntime | null): string | null {
  const vite = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined)?.trim();
  const fromApi = runtime?.clerkPublishableKey?.trim();
  return vite || fromApi || null;
}

/** Clerk Account Portal base URL (e.g. https://accounts.viger.cloud). */
export function resolveClerkAccountsUrl(runtime?: AuthRuntime | null): string | null {
  const vite = (import.meta.env.VITE_CLERK_ACCOUNTS_URL as string | undefined)?.trim();
  const fromApi = runtime?.clerkAccountsUrl?.trim();
  const url = fromApi || vite || null;
  return url ? url.replace(/\/$/, "") : null;
}

export function usesClerkAccountPortal(runtime?: AuthRuntime | null): boolean {
  return !!resolveClerkAccountsUrl(runtime);
}

export function resolveAuthProvider(runtime?: AuthRuntime | null): "clerk" | "replit" {
  if (runtime?.authProvider === "replit") return "replit";
  if (runtime?.authProvider === "clerk") return "clerk";
  const vite = (import.meta.env.VITE_AUTH_PROVIDER as string | undefined)?.trim();
  if (vite === "replit") return "replit";
  return "clerk";
}

export function isClerkMode(runtime?: AuthRuntime | null): boolean {
  return resolveAuthProvider(runtime) === "clerk";
}

import { APP_BASE, resolveAppPath } from "./appPaths";

export function getAppOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  const configured = (import.meta.env.VITE_APP_URL as string | undefined)?.trim();
  return configured?.replace(/\/$/, "") ?? "";
}

export function appUrl(path: string): string {
  const origin = getAppOrigin();
  const appPath = resolveAppPath(path);
  return origin ? `${origin}${appPath}` : appPath;
}

export { APP_BASE };

/** Account Portal link with redirect back to this app after auth. */
export function clerkAccountPortalUrl(
  portalPath: "/sign-in" | "/sign-up",
  redirectPath = "/",
  runtime?: AuthRuntime | null,
): string | null {
  const base = resolveClerkAccountsUrl(runtime);
  if (!base) return null;
  const redirect = encodeURIComponent(appUrl(redirectPath));
  return `${base}${portalPath}?redirect_url=${redirect}`;
}
