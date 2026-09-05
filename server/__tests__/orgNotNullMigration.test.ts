import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");

function readMigration(name: string): string {
  return readFileSync(path.join(repoRoot, "migrations", name), "utf8");
}

function migrationOrder(): string[] {
  return readdirSync(path.join(repoRoot, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function enforcedTables(sql: string): string[] {
  return [
    ...sql.matchAll(/ALTER TABLE\s+([a-z_]+)\s+ALTER COLUMN org_id SET NOT NULL/g),
  ].map((match) => match[1]);
}

function adoptionTables(sql: string): Set<string> {
  return new Set([...sql.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]));
}

describe("org_id NOT NULL migrations", () => {
  it("adopts safe single-org orphans before 002 checks org_id nullability", () => {
    const files = migrationOrder();
    expect(files.indexOf("002_org_not_null.sql")).toBeGreaterThanOrEqual(0);
    expect(files.indexOf("048_backfill_orphan_org_rows.sql")).toBeGreaterThanOrEqual(0);
    expect(files.indexOf("002_org_not_null.sql")).toBeLessThan(
      files.indexOf("048_backfill_orphan_org_rows.sql"),
    );

    const migration002 = readMigration("002_org_not_null.sql");
    const adoptionIndex = migration002.indexOf("UPDATE %I SET org_id = $1 WHERE org_id IS NULL");
    const precheckIndex = migration002.indexOf("Cannot set NOT NULL: org_id NULLs remain");

    expect(adoptionIndex).toBeGreaterThanOrEqual(0);
    expect(precheckIndex).toBeGreaterThanOrEqual(0);
    expect(adoptionIndex).toBeLessThan(precheckIndex);
  });

  it("keeps orphan-adoption tables aligned with every enforced org-owned table", () => {
    const migration002 = readMigration("002_org_not_null.sql");
    const migration048 = readMigration("048_backfill_orphan_org_rows.sql");
    const tables = enforcedTables(migration002);

    expect(tables).toContain("order_expenses");
    expect(tables.length).toBeGreaterThan(5);

    const adoptedIn002 = adoptionTables(migration002);
    const adoptedIn048 = adoptionTables(migration048);
    const missingFrom002 = tables.filter((table) => !adoptedIn002.has(table));
    const missingFrom048 = tables.filter((table) => !adoptedIn048.has(table));

    expect({ missingFrom002, missingFrom048 }).toEqual({
      missingFrom002: [],
      missingFrom048: [],
    });
  });
});
