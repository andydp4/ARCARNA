/**
 * A tiny API client for the money audit tools, signed in per request with the
 * journey suite's localhost-only impersonation headers (tests/journeys/
 * fixtures.ts). Every write in the money dataset goes through here, so the
 * dataset is made by the app's own routes, not by inserting rows.
 */
export const SEED_USERS = {
  SUPER_ADMIN: "seed-super-admin",
  ADMIN: "seed-admin",
  MANAGER: "seed-manager",
  CASHIER: "seed-cashier",
} as const;

const TEST_SECRET = process.env.PHASE2D_TEST_SECRET ?? "journey-suite-local-secret";

export function baseUrl(): string {
  if (process.env.MONEY_BASE_URL) return process.env.MONEY_BASE_URL;
  const port = process.env.PORT ?? "5000";
  return `http://127.0.0.1:${port}`;
}

export type ApiResult<T = any> = { status: number; ok: boolean; body: T; text: string };

export async function api<T = any>(
  userId: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      "x-test-replit-user-id": userId,
      "x-test-secret": TEST_SECRET,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // not JSON (CSV, PDF, HTML) — keep the text
  }
  return { status: res.status, ok: res.ok, body: parsed as T, text };
}

/** Like {@link api} but throws with the body on anything but 2xx. */
export async function must<T = any>(
  userId: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const r = await api<T>(userId, method, path, body, headers);
  if (!r.ok) throw new Error(`${method} ${path} as ${userId} -> ${r.status}: ${r.text.slice(0, 500)}`);
  return r.body;
}
