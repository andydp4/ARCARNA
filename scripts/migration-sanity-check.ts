#!/usr/bin/env npx tsx
/**
 * Migration sanity check for existing DBs.
 * Loads .env then .env.production (if present) before connecting.
 *
 * Run: npm run migration:sanity
 * Or:  DATABASE_URL=... npm run migration:sanity
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";
import { sql } from "drizzle-orm";

loadEnv({ path: resolve(process.cwd(), ".env") });
if (existsSync(resolve(process.cwd(), ".env.production"))) {
  loadEnv({ path: resolve(process.cwd(), ".env.production"), override: true });
}

interface PkInfo {
  tableName: string;
  columns: string[];
}

const REQUIRED_TABLES = [
  "organizations",
  "analytics_daily",
  "domain_outbox",
  "event_outbox",
  "job_queue",
  "whatsapp_accounts",
  "whatsapp_conversations",
  "whatsapp_messages",
  "whatsapp_customer_links",
] as const;

const DOMAIN_OUTBOX_COLUMNS = [
  "id",
  "org_id",
  "type",
  "data",
  "event_type",
  "aggregate_type",
  "aggregate_id",
  "payload",
  "processed_at",
  "created_at",
];

async function getAnalyticsPk(db: {
  execute: (q: ReturnType<typeof sql>) => Promise<unknown>;
}): Promise<PkInfo[] | null> {
  const result = await db.execute(sql`
    SELECT
      tc.table_name,
      array_agg(kcu.column_name ORDER BY kcu.ordinal_position) as columns
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name IN ('analytics_daily', 'analytics_weekly', 'analytics_monthly')
    GROUP BY tc.table_name
  `);
  const raw = result as { rows?: unknown[] };
  const rows = (raw?.rows ?? (Array.isArray(result) ? result : [result])) as {
    table_name: string;
    columns: unknown;
  }[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.map((r) => {
    const cols = r.columns;
    const colArr = Array.isArray(cols) ? cols : typeof cols === "string" ? [cols] : [];
    return { tableName: r.table_name, columns: colArr as string[] };
  });
}

async function tableExists(
  db: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  name: string,
): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${name}
    LIMIT 1
  `);
  const raw = r as { rows?: unknown[] };
  const rows = raw?.rows ?? (Array.isArray(r) ? r : [r]);
  return Array.isArray(rows) && rows.length > 0;
}

async function columnExists(
  db: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  table: string,
  column: string,
): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    LIMIT 1
  `);
  const raw = r as { rows?: unknown[] };
  const rows = raw?.rows ?? (Array.isArray(r) ? r : [r]);
  return Array.isArray(rows) && rows.length > 0;
}

async function getOrgCount(db: {
  execute: (q: ReturnType<typeof sql>) => Promise<unknown>;
}): Promise<number> {
  const r = await db.execute(sql`SELECT COUNT(*)::int as c FROM organizations`);
  const raw = r as { rows?: { c: number }[] };
  const rows = raw?.rows ?? (Array.isArray(r) ? r : []);
  return (rows as { c: number }[])?.[0]?.c ?? 0;
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL required (set in .env or .env.production)");
    process.exit(1);
  }

  const { db } = await import("../server/db");
  let failed = false;

  console.log("\n=== Migration Sanity Check ===\n");

  for (const table of REQUIRED_TABLES) {
    const ok = await tableExists(db, table);
    console.log(`${ok ? "OK" : "MISSING"}: table ${table}`);
    if (!ok) failed = true;
  }

  const hasDomainOutbox = await tableExists(db, "domain_outbox");
  if (hasDomainOutbox) {
    for (const col of DOMAIN_OUTBOX_COLUMNS) {
      const ok = await columnExists(db, "domain_outbox", col);
      console.log(`${ok ? "OK" : "MISSING"}: domain_outbox.${col}`);
      if (!ok) failed = true;
    }
  }

  const pkInfo = await getAnalyticsPk(db);
  const hasAnalyticsDaily = await tableExists(db, "analytics_daily");
  let orgCount = 0;
  try {
    orgCount = await getOrgCount(db);
  } catch {
    // organizations may not exist on empty DB
  }

  console.log("\n--- Analytics PK ---");
  const dailyPk = pkInfo?.find((p) => p.tableName === "analytics_daily");
  console.log("analytics_daily exists:", hasAnalyticsDaily);
  console.log("analytics PK shape:", dailyPk ? dailyPk.columns.join(", ") : "N/A");
  console.log("organizations count:", orgCount);

  if (hasAnalyticsDaily && dailyPk) {
    const hasOldPk =
      dailyPk.columns.length === 1 && dailyPk.columns[0] === "date";
    const hasNewPk =
      dailyPk.columns.includes("org_id") && dailyPk.columns.includes("date");

    if (hasOldPk) {
      failed = true;
      console.log("\n>>> ANALYTICS TABLES HAVE OLD PK (date-only). MIGRATION REQUIRED. <<<\n");
      if (orgCount > 1) {
        console.log("Use migrations/001_analytics_org_pk_with_org.sql per org.");
      } else {
        console.log("Use migrations/001_analytics_org_pk.sql");
      }
    } else if (hasNewPk) {
      console.log("\nAnalytics tables have org-scoped PK.");
    }
  } else if (!hasAnalyticsDaily) {
    console.log("\nNo analytics_daily — run migrations or: npm run db:push");
  }

  if (failed) {
    console.error("\nSanity check FAILED. Apply migrations/009_domain_outbox_and_workers.sql and earlier files.");
    process.exit(1);
  }

  console.log("\nSanity check PASSED.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
