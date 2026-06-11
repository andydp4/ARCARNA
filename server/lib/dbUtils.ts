/**
 * Transient Postgres errors (Neon suspend/restart, pooler recycle, network blips).
 * SQLSTATE 57P01: "terminating connection due to administrator command".
 */

const TRANSIENT_CODES = new Set([
  "57P01",
  "08006",
  "08001",
  "08004",
  "53300",
]);

const TRANSIENT_MESSAGE_FRAGMENTS = [
  "terminating connection due to administrator command",
  "Connection terminated unexpectedly",
  "ECONNRESET",
  "ETIMEDOUT",
  "socket hang up",
];

function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as { code?: string }).code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** True when a single retry (fresh connection) is likely to succeed. */
export function isTransientPostgresError(err: unknown): boolean {
  const code = errorCode(err);
  if (code && TRANSIENT_CODES.has(code)) return true;
  const msg = errorMessage(err);
  return TRANSIENT_MESSAGE_FRAGMENTS.some((frag) => msg.includes(frag));
}

export type WithRetriesOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
};

/** Retry DB work after Neon wake / stale pool connections. Used by storage, workers, health metrics. */
export async function withRetries<T>(
  fn: () => Promise<T>,
  options?: WithRetriesOptions,
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 150;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isTransientPostgresError(err)) {
        throw err;
      }
      const delay = baseDelayMs * attempt;
      console.warn(
        `[db] Transient Postgres error (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms:`,
        errorMessage(err),
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}
