/**
 * Phase 6.5 — Migration. A database built from scratch must reach the same
 * schema as the one this suite has been running against.
 *
 * The test builds a genuinely fresh database (CREATE DATABASE → drizzle-kit
 * push → every SQL file listed in scripts/apply-migrations-pm2.sh) and diffs
 * information_schema columns, plus indexes and constraints, against
 * process.env.DATABASE_URL. Any difference is schema drift.
 *
 * NOTE ON THE SHELL SCRIPT: scripts/apply-migrations-pm2.sh cannot be reused
 * verbatim here. It does `set -a; source .env; set +a`, so a DATABASE_URL
 * present in .env silently OVERRIDES an exported one and the script migrates
 * whatever .env points at. This test therefore reads the script's file list and
 * applies those exact files itself, with psql, against the URL it intends.
 *
 * Requires DATABASE_URL (imports ../db at module level) → must be added to the
 * `exclude` list in vitest.config.ts for the no-DB run.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import pg from "pg";
// Importing ../db is what ties this file to DATABASE_URL; the pool is not used
// for the comparison itself (each side gets its own short-lived client).
import "../db";

const execFileAsync = promisify(execFile);

const hasDb = !!process.env.DATABASE_URL;
const repoRoot = path.resolve(__dirname, "../..");
const FRESH_DB_NAME = "midnight_integrity_fresh_check";

let workingUrl = "";
let freshUrl = "";
let adminUrl = "";
let freshBuilt = false;
let buildError: string | null = null;

/** Migration files, read from the shell script so the two can never diverge. */
function migrationFilesFromScript(): string[] {
  const script = readFileSync(
    path.join(repoRoot, "scripts/apply-migrations-pm2.sh"),
    "utf8",
  );
  const matches = script.match(/migrations\/[0-9A-Za-z_]+\.sql/g) ?? [];
  return Array.from(new Set(matches));
}

function swapDatabase(url: string, dbName: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

type SchemaFacts = {
  columns: string[];
  indexes: string[];
  constraints: string[];
  tables: string[];
};

async function schemaFacts(url: string): Promise<SchemaFacts> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const one = async (query: string) => {
      const res = await client.query(query);
      return res.rows.map((r) => String(Object.values(r)[0])).sort();
    };
    return {
      columns: await one(`
        SELECT table_name || '.' || column_name || ' ' || data_type
               || ' null=' || is_nullable
               || ' def=' || COALESCE(column_default, '-') AS fact
        FROM information_schema.columns WHERE table_schema = 'public'`),
      indexes: await one(`
        SELECT tablename || ' ' || indexname || ' ' || indexdef AS fact
        FROM pg_indexes WHERE schemaname = 'public'`),
      constraints: await one(`
        SELECT tc.table_name || ' ' || tc.constraint_type || ' '
               || COALESCE(cc.check_clause, '') AS fact
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.check_constraints cc
          ON cc.constraint_name = tc.constraint_name
        WHERE tc.table_schema = 'public'`),
      tables: await one(`
        SELECT table_name AS fact
        FROM information_schema.tables WHERE table_schema = 'public'`),
    };
  } finally {
    await client.end();
  }
}

async function adminExec(sqlText: string) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(sqlText);
  } finally {
    await client.end();
  }
}

/** Applies the migration list with psql, exactly as the shell script does. */
async function applyMigrations(url: string) {
  for (const file of migrationFilesFromScript()) {
    const full = path.join(repoRoot, file);
    if (!existsSync(full)) continue;
    // ON_ERROR_STOP=0 mirrors the script: "already exists" notices are expected
    // when re-running, and must not abort the run.
    await execFileAsync("psql", [url, "-q", "-v", "ON_ERROR_STOP=0", "-f", full], {
      env: { ...process.env, PGCONNECT_TIMEOUT: "10" },
      maxBuffer: 32 * 1024 * 1024,
    }).catch(() => undefined);
  }
}

beforeAll(async () => {
  if (!hasDb) return;
  workingUrl = process.env.DATABASE_URL!;
  freshUrl = swapDatabase(workingUrl, FRESH_DB_NAME);
  adminUrl = swapDatabase(workingUrl, "postgres");

  try {
    await adminExec(`DROP DATABASE IF EXISTS ${FRESH_DB_NAME}`);
    await adminExec(`CREATE DATABASE ${FRESH_DB_NAME}`);
    await execFileAsync("npx", ["drizzle-kit", "push"], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: freshUrl },
      maxBuffer: 32 * 1024 * 1024,
    });
    await applyMigrations(freshUrl);
    freshBuilt = true;
  } catch (err) {
    buildError = err instanceof Error ? err.message : String(err);
  }
}, 600_000);

afterAll(async () => {
  if (!hasDb || !freshBuilt) return;
  await adminExec(`DROP DATABASE IF EXISTS ${FRESH_DB_NAME}`).catch(() => undefined);
});

describe.skipIf(!hasDb)("6.5 fresh database reaches the same schema", () => {
  it("built the fresh database without error", () => {
    // Reported as its own assertion so a build failure is never mistaken for
    // "no drift found".
    expect(buildError).toBeNull();
    expect(freshBuilt).toBe(true);
  });

  it("has the same tables", async () => {
    const [work, fresh] = await Promise.all([
      schemaFacts(workingUrl),
      schemaFacts(freshUrl),
    ]);
    expect(work.tables.length).toBeGreaterThan(50);
    expect(fresh.tables).toEqual(work.tables);
  });

  it("has the same columns, types, nullability and defaults", async () => {
    const [work, fresh] = await Promise.all([
      schemaFacts(workingUrl),
      schemaFacts(freshUrl),
    ]);
    expect(work.columns.length).toBeGreaterThan(500);

    const missing = work.columns.filter((c) => !fresh.columns.includes(c));
    const extra = fresh.columns.filter((c) => !work.columns.includes(c));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("has the same indexes", async () => {
    const [work, fresh] = await Promise.all([
      schemaFacts(workingUrl),
      schemaFacts(freshUrl),
    ]);
    expect(work.indexes.length).toBeGreaterThan(100);
    const missing = work.indexes.filter((i) => !fresh.indexes.includes(i));
    const extra = fresh.indexes.filter((i) => !work.indexes.includes(i));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("has the same constraints", async () => {
    const [work, fresh] = await Promise.all([
      schemaFacts(workingUrl),
      schemaFacts(freshUrl),
    ]);
    expect(work.constraints.length).toBeGreaterThan(100);
    expect(fresh.constraints).toEqual(work.constraints);
  });

  it("is idempotent: re-applying every migration changes nothing", async () => {
    const before = await schemaFacts(freshUrl);
    await applyMigrations(freshUrl);
    const after = await schemaFacts(freshUrl);
    expect(after).toEqual(before);
  }, 600_000);

  it("carries the analytics_daily composite primary key the sanity check asserts", async () => {
    // Migration 001 rebuilds this PK; a fresh DB must land on {org_id, date},
    // not the pre-migration shape.
    const client = new pg.Client({ connectionString: freshUrl });
    await client.connect();
    try {
      const res = await client.query(`
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'analytics_daily'::regclass AND i.indisprimary
        ORDER BY a.attname`);
      expect(res.rows.map((r) => r.attname)).toEqual(["date", "org_id"]);
    } finally {
      await client.end();
    }
  });
});
