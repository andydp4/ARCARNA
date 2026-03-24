#!/usr/bin/env npx tsx
/**
 * Migration sanity check for existing DBs.
 * Detects analytics table PK shape and org count; prints migration instructions.
 * Optional in CI, mandatory for release notes.
 * Run: DATABASE_URL=... npx tsx scripts/migration-sanity-check.ts
 */
import { sql } from "drizzle-orm";

interface PkInfo {
  tableName: string;
  columns: string[];
}

async function getAnalyticsPk(db: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }): Promise<PkInfo[] | null> {
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
  const rows = (raw?.rows ?? (Array.isArray(result) ? result : [result])) as { table_name: string; columns: unknown }[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.map((r) => {
    const cols = r.columns;
    const colArr = Array.isArray(cols) ? cols : typeof cols === "string" ? [cols] : [];
    return { tableName: r.table_name, columns: colArr as string[] };
  });
}

async function tableExists(db: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, name: string): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${name}
    LIMIT 1
  `);
  const raw = r as { rows?: unknown[] };
  const rows = raw?.rows ?? (Array.isArray(r) ? r : [r]);
  return Array.isArray(rows) && rows.length > 0;
}

async function getOrgCount(db: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }): Promise<number> {
  const r = await db.execute(sql`SELECT COUNT(*)::int as c FROM organizations`);
  const raw = r as { rows?: { c: number }[] };
  const rows = raw?.rows ?? (Array.isArray(r) ? r : []);
  return (rows as { c: number }[])?.[0]?.c ?? 0;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }

  const { db } = await import("../server/db");
  const hasAnalyticsDaily = await tableExists(db, "analytics_daily");
  const pkInfo = await getAnalyticsPk(db);
  let orgCount = 0;
  try {
    orgCount = await getOrgCount(db);
  } catch {
    // organizations table may not exist yet
  }

  const dailyPk = pkInfo?.find((p) => p.tableName === "analytics_daily");
  const hasOldPk =
    dailyPk &&
    dailyPk.columns.length === 1 &&
    dailyPk.columns[0] === "date";
  const hasNewPk =
    dailyPk &&
    dailyPk.columns.includes("org_id") &&
    dailyPk.columns.includes("date");

  console.log("\n=== Migration Sanity Check ===\n");
  console.log("analytics_daily exists:", hasAnalyticsDaily);
  console.log("analytics PK shape:", dailyPk ? dailyPk.columns.join(", ") : "N/A");
  console.log("organizations count:", orgCount);

  if (!hasAnalyticsDaily) {
    console.log("\nNo analytics tables. Use: npm run db:push");
    process.exit(0);
  }

  if (hasNewPk) {
    console.log("\nAnalytics tables already have org-scoped PK. No migration needed.");
    process.exit(0);
  }

  if (hasOldPk) {
    console.log("\n>>> ANALYTICS TABLES HAVE OLD PK (date-only). MIGRATION REQUIRED. <<<\n");
    if (orgCount > 1) {
      console.log(
        "Multiple orgs exist. Do NOT use 001_analytics_org_pk.sql."
      );
      console.log(
        "Use 001_analytics_org_pk_with_org.sql with -v org_id per org:\n"
      );
      console.log(
        "  psql $DATABASE_URL -v org_id=YOUR_ORG_UUID -f migrations/001_analytics_org_pk_with_org.sql"
      );
      console.log(
        "\nRun once per org, or consolidate to single org first."
      );
    } else {
      console.log(
        "Single org (or none). Use 001_analytics_org_pk.sql:\n"
      );
      console.log(
        "  psql $DATABASE_URL -f migrations/001_analytics_org_pk.sql"
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
