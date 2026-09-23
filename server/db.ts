import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as PgPool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import ws from "ws";
import * as schema from "@shared/schema";
import { chooseDriver, sslFor, type DbDriver } from "./lib/dbConnection";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const connectionString = process.env.DATABASE_URL;

/** node-postgres everywhere (Neon included); the Neon WebSocket driver only on DB_DRIVER=neon. See server/lib/dbConnection.ts. */
export const driver: DbDriver = chooseDriver(process.env);

/** Prefer Neon pooler host (-pooler.neon.tech) in production — survives compute suspend better. */
export function usesNeonPooler(): boolean {
  return connectionString.includes("-pooler.");
}

function attachPoolErrorHandler(pool: NeonPool | PgPool, label: string) {
  // node-postgres Pool emits 'error' on idle clients; Neon serverless Pool typings omit it.
  (pool as PgPool).on?.("error", (err: Error) => {
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
  const pool = new PgPool({
    connectionString,
    ssl: sslFor(connectionString),
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
    : drizzlePg({ client: pool as PgPool, schema });
