type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      try {
        const token = await tokenGetter();
        if (token) return token;
      } catch {
        // Session may still be hydrating after cross-host redirect.
      }
    }
    await sleep(intervalMs);
  }
  return null;
}

export async function withClerkAuthHeaders(base?: HeadersInit): Promise<Headers> {
  const headers = new Headers(base);
  if (!tokenGetter) return headers;
  try {
    const token = await tokenGetter();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  } catch {
    // Clerk session may still be hydrating after Account Portal redirect.
  }
  return headers;
}
