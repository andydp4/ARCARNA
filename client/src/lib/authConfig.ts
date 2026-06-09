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

/** Best-effort registrable domain (e.g. accounts.viger.cloud → viger.cloud). */
export function clerkRegistrableDomain(hostname: string): string {
  const host = hostname.toLowerCase();
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  const twoPartTlds = new Set(["co.uk", "com.au", "org.uk", "net.au"]);
  const lastTwo = parts.slice(-2).join(".");
  if (twoPartTlds.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

/** True when Account Portal host differs from the app (e.g. accounts.viger.cloud vs viger.cloud). */
export function usesClerkCrossHostAccountPortal(runtime?: AuthRuntime | null): boolean {
  const accounts = resolveClerkAccountsUrl(runtime);
  if (!accounts || typeof window === "undefined") return false;
  try {
    return new URL(accounts).hostname !== window.location.hostname;
  } catch {
    return false;
  }
}

/**
 * True only for Clerk multi-domain satellites (different registrable domains).
 * Subdomains of the primary domain (accounts.viger.cloud + viger.cloud) are NOT satellites —
 * Clerk shares sessions across subdomains by default.
 */
export function usesClerkSatelliteDomain(runtime?: AuthRuntime | null): boolean {
  const accounts = resolveClerkAccountsUrl(runtime);
  if (!accounts || typeof window === "undefined") return false;
  try {
    const accountsHost = new URL(accounts).hostname;
    const appHost = window.location.hostname;
    if (accountsHost === appHost) return false;
    return clerkRegistrableDomain(accountsHost) !== clerkRegistrableDomain(appHost);
  } catch {
    return false;
  }
}

export function clerkSatelliteDomain(): string | undefined {
  if (typeof window === "undefined") return undefined;
  // Clerk satellite `domain` must be a bare hostname (e.g. viger.cloud), not origin with scheme.
  return window.location.hostname;
}

/** Optional FAPI proxy when clerk.{domain} DNS is unavailable (see Clerk satellite docs). */
export function resolveClerkProxyUrl(): string | undefined {
  const configured = (import.meta.env.VITE_CLERK_PROXY_URL as string | undefined)?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return undefined;
}

/** Origins Clerk may redirect back to after Account Portal auth (satellite sync). */
export function clerkSatelliteRedirectOrigins(runtime?: AuthRuntime | null): string[] {
  const origins = new Set<string>();
  const appOrigin = getAppOrigin();
  const accounts = resolveClerkAccountsUrl(runtime);
  if (appOrigin) origins.add(appOrigin);
  if (accounts) origins.add(accounts);
  return [...origins];
}

/** Account Portal link with redirect back to this app after auth. */
export function clerkAccountPortalUrl(
  portalPath: "/sign-in" | "/sign-up",
  redirectPath = "/",
  runtime?: AuthRuntime | null,
): string | null {
  const base = resolveClerkAccountsUrl(runtime);
  if (!base) return null;
  const params = new URLSearchParams({
    redirect_url: appUrl(redirectPath),
  });
  // Cross-host Account Portal (e.g. accounts.* → viger.cloud) requires link_domain on the redirect.
  if (usesClerkCrossHostAccountPortal(runtime)) {
    const linkDomain = clerkSatelliteDomain();
    if (linkDomain) params.set("link_domain", linkDomain);
  }
  return `${base}${portalPath}?${params.toString()}`;
}

/** Account Portal sign-out (ends Clerk session, then returns to the app). */
export function clerkAccountPortalSignOutUrl(
  redirectPath = "/",
  runtime?: AuthRuntime | null,
): string | null {
  const base = resolveClerkAccountsUrl(runtime);
  if (!base) return null;
  const redirect = encodeURIComponent(appUrl(redirectPath));
  return `${base}/sign-out?redirect_url=${redirect}`;
}
