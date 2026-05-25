export type AuthRuntime = {
  authProvider?: "clerk" | "replit";
  clerkPublishableKey?: string | null;
  devAuthBypass?: boolean;
};

/** Publishable key: build-time Vite env first, then runtime API. */
export function resolveClerkPublishableKey(runtime?: AuthRuntime | null): string | null {
  const vite = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined)?.trim();
  const fromApi = runtime?.clerkPublishableKey?.trim();
  return vite || fromApi || null;
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
