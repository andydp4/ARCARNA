/**
 * How the server connects to Postgres. Pure, so it is testable without a
 * database (server/__tests__/dbConnection.test.ts).
 *
 * The Neon WebSocket driver (@neondatabase/serverless) is built for serverless
 * and edge runtimes. On the always-on VPS it was chosen automatically for any
 * neon.tech URL, and when Neon refused connections (the compute quota ran out)
 * its own error handler crashed — "Cannot set property message of #<ErrorEvent>
 * which has only a getter" — hiding the real reason. A long-running server now
 * uses node-postgres over TCP for every URL, Neon included; the WebSocket
 * driver is only used when DB_DRIVER=neon asks for it.
 */
export type DbDriver = "neon" | "node-postgres";

export function chooseDriver(env: { DB_DRIVER?: string }): DbDriver {
  return env.DB_DRIVER === "neon" ? "neon" : "node-postgres";
}

/**
 * Neon only accepts TLS. node-postgres honours `sslmode` in the URL; when a
 * Neon URL carries none, TLS is forced here (with certificate verification)
 * rather than letting the first connection fail after a driver switch.
 */
export function sslFor(connectionString: string): { rejectUnauthorized: true } | undefined {
  const isNeon = /neon\.tech/i.test(connectionString);
  const hasSslMode = /[?&]sslmode=/i.test(connectionString);
  return isNeon && !hasSslMode ? { rejectUnauthorized: true } : undefined;
}
