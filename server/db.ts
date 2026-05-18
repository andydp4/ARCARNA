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

function createPool() {
  if (driver === "neon") {
    neonConfig.webSocketConstructor = ws;
    return new NeonPool({ connectionString });
  }
  return new pg.Pool({ connectionString });
}

export const pool = createPool();
export const db =
  driver === "neon"
    ? drizzleNeon({ client: pool as NeonPool, schema })
    : drizzlePg({ client: pool as pg.Pool, schema });
