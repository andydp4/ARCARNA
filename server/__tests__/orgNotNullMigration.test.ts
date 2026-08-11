import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function migration(name: string): string {
  return readFileSync(path.join(repoRoot, "migrations", name), "utf8");
}

function tablesCheckedByOrgNotNullMigration(sql: string): string[] {
  return [
    ...new Set(
      [...sql.matchAll(/FROM\s+([a-z_]+)\s+WHERE\s+org_id\s+IS\s+NULL/g)].map(
        (match) => match[1],
      ),
    ),
  ];
}

describe("org_id NOT NULL migrations", () => {
  it("adopts single-org orphan rows before the hard NOT NULL pre-check", () => {
    const sql = migration("002_org_not_null.sql");
    const adoptionStart = sql.indexOf("Production migrations are applied in version order");
    const preCheckStart = sql.indexOf("-- Explicit pre-check");

    expect(adoptionStart).toBeGreaterThanOrEqual(0);
    expect(preCheckStart).toBeGreaterThan(adoptionStart);

    const adoptionSql = sql.slice(adoptionStart, preCheckStart);
    expect(adoptionSql).toContain("org_count = 1");
    expect(adoptionSql).toContain("org_count > 1");
    expect(adoptionSql).toContain("UPDATE %I SET org_id = $1 WHERE org_id IS NULL");

    for (const table of tablesCheckedByOrgNotNullMigration(sql)) {
      expect(adoptionSql, `${table} must be adopted before the pre-check`).toContain(
        `'${table}'`,
      );
    }
  });

  it("keeps the late orphan backfill aligned with the NOT NULL migration", () => {
    const notNullSql = migration("002_org_not_null.sql");
    const lateBackfillSql = migration("048_backfill_orphan_org_rows.sql");

    for (const table of tablesCheckedByOrgNotNullMigration(notNullSql)) {
      expect(
        lateBackfillSql,
        `${table} is enforced by 002 and must also be reported/adopted by 048`,
      ).toContain(`'${table}'`);
    }
  });
});
