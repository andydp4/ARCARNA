import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import pg from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import ws from "ws";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const connectionString = process.env.DATABASE_URL;

/** Use node-postgres for Docker/local Postgres; neon driver for Neon cloud URLs. */
export const driver: "neon" | "node-postgres" =
  process.env.DB_DRIVER === "neon"
    ? "neon"
    : process.env.DB_DRIVER === "node-postgres"
      ? "node-postgres"
      : connectionString.includes("neon.tech")
        ? "neon"
        : "node-postgres";

/** Prefer Neon pooler host (-pooler.neon.tech) in production — survives compute suspend better. */
export function usesNeonPooler(): boolean {
  return connectionString.includes("-pooler.");
}

function attachPoolErrorHandler(pool: NeonPool | pg.Pool, label: string) {
  // node-postgres Pool emits 'error' on idle clients; Neon serverless Pool typings omit it.
  (pool as pg.Pool).on?.("error", (err: Error) => {
    console.error(`[db] Idle ${label} pool client error (non-fatal):`, err);
  });
}

function createPool() {
  if (driver === "neon") {
    neonConfig.webSocketConstructor = ws;
    if (!usesNeonPooler() && process.env.NODE_ENV === "production") {
      console.warn(
        "[db] DATABASE_URL does not use Neon pooler (-pooler.neon.tech). " +
          "Direct connections may see 57P01 when compute suspends; use the pooler URL from Neon dashboard.",
      );
    }
    const pool = new NeonPool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
    });
    attachPoolErrorHandler(pool, "neon");
    return pool;
  }
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  attachPoolErrorHandler(pool, "node-postgres");
  return pool;
}

export const pool = createPool();
export const db =
  driver === "neon"
    ? drizzleNeon({ client: pool as NeonPool, schema })
    : drizzlePg({ client: pool as pg.Pool, schema });
