type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;

/** Cap on a single clerk-js getToken() call so a stalled Clerk frontend-API
 * request can't block every apiFetch indefinitely (requests then go out
 * unauthenticated and the caller's retry logic takes over). */
const TOKEN_CALL_TIMEOUT_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getTokenWithTimeout(timeoutMs = TOKEN_CALL_TIMEOUT_MS): Promise<string | null> {
  if (!tokenGetter) return null;
  try {
    return await Promise.race([
      tokenGetter(),
      sleep(timeoutMs).then(() => null),
    ]);
  } catch {
    // Session may still be hydrating after cross-host redirect.
    return null;
  }
}

/** Registered by ClerkTokenBridge when ClerkProvider is active. */
export function registerClerkTokenGetter(getter: TokenGetter | null): void {
  tokenGetter = getter;
}

export function isClerkTokenGetterReady(): boolean {
  return tokenGetter !== null;
}

/**
 * Wait until Clerk exposes a session JWT (common race after Account Portal redirect
 * on accounts.* back to the app host).
 */
export async function waitForClerkToken(options?: {
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const intervalMs = options?.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (tokenGetter) {
      const remaining = deadline - Date.now();
      const token = await getTokenWithTimeout(Math.min(remaining, TOKEN_CALL_TIMEOUT_MS));
      if (token) return token;
    }
    await sleep(intervalMs);
  }
  return null;
}

export async function withClerkAuthHeaders(base?: HeadersInit): Promise<Headers> {
  const headers = new Headers(base);
  const token = await getTokenWithTimeout();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}
