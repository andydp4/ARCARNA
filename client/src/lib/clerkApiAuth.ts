type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;

/** Registered by ClerkTokenBridge when ClerkProvider is active. */
export function registerClerkTokenGetter(getter: TokenGetter | null): void {
  tokenGetter = getter;
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
