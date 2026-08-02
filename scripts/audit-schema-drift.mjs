#!/usr/bin/env node
/**
 * Two Drizzle schema files declare the same physical tables:
 * `shared/schema.ts` (camelCase exports) and `apps/server/src/db/schema.ts`
 * (snake_case exports). Both are imported by live code paths.
 *
 * When they disagree about a column's type, nothing fails loudly. Drizzle
 * simply maps the value with whichever declaration the calling module happened
 * to import — and its `integer` mapper runs `parseInt` on what the driver
 * returns. So after `order_items.quantity` became numeric(14,3), the route that
 * builds the OrderCreated event read `0.400` through a stale `integer`
 * declaration, got `0`, and published a sale of zero units. The order was
 * charged correctly and the stock never moved. No error anywhere.
 *
 * This compares the two files column by column and fails on any disagreement.
 *
 * Run: node scripts/audit-schema-drift.mjs
 */
import { readFileSync } from "node:fs";

const FILES = [
  { label: "shared/schema.ts", path: "shared/schema.ts" },
  { label: "apps/server/src/db/schema.ts", path: "apps/server/src/db/schema.ts" },
];

/**
 * Extracts `table -> column -> type` from a Drizzle schema file.
 *
 * Deliberately shallow: it reads the `pgTable("name", { ... })` blocks and the
 * column builder each key starts with. That is enough to catch a type
 * disagreement and cannot misread a column as absent, which is what matters —
 * a check that invents differences would be worse than no check.
 */
function parseSchema(src) {
  const tables = new Map();
  const tableRe = /pgTable\(\s*['"]([a-z0-9_]+)['"]\s*,\s*\{/g;
  let m;
  while ((m = tableRe.exec(src)) !== null) {
    const tableName = m[1];
    // Walk to the matching close brace of the column object.
    let depth = 0;
    let i = src.indexOf("{", m.index + m[0].length - 1);
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = src.slice(start + 1, i);

    const columns = new Map();
    // `name: builder('col_name', ...)` — capture the builder and the db column.
    const colRe = /(\w+)\s*:\s*(\w+)\(\s*['"]([a-z0-9_]+)['"]/g;
    let c;
    while ((c = colRe.exec(body)) !== null) {
      const [, , builder, dbColumn] = c;

      // Read only this column's own arguments. A fixed lookahead spilled into
      // the *next* column and reported `uuid(10,2)` and `varchar(10,2)` —
      // differences that do not exist. An audit that invents findings gets
      // ignored, and then it is worth nothing when it is right.
      const openParen = body.indexOf("(", c.index + c[1].length);
      let depth = 0;
      let k = openParen;
      for (; k < body.length; k++) {
        if (body[k] === "(") depth++;
        else if (body[k] === ")") {
          depth--;
          if (depth === 0) break;
        }
      }
      const args = body.slice(openParen, k + 1);

      // Precision/scale/mode matter for numeric: 14,3 vs 10,2 is a real
      // difference, and mode decides whether reads are numbers or strings.
      const precision = /precision\s*:\s*(\d+)/.exec(args)?.[1];
      const scale = /scale\s*:\s*(\d+)/.exec(args)?.[1];
      const mode = /mode\s*:\s*['"](\w+)['"]/.exec(args)?.[1];
      const signature =
        builder + (precision ? `(${precision},${scale ?? 0})` : "") + (mode ? `:${mode}` : "");
      columns.set(dbColumn, signature);
    }
    // A table can legitimately appear once per file; later definitions win.
    tables.set(tableName, columns);
  }
  return tables;
}

const parsed = FILES.map((f) => ({ ...f, tables: parseSchema(readFileSync(f.path, "utf8")) }));
const [a, b] = parsed;

const drift = [];
for (const [tableName, aCols] of a.tables) {
  const bCols = b.tables.get(tableName);
  if (!bCols) continue; // only one file declares it — nothing to disagree about
  for (const [column, aType] of aCols) {
    const bType = bCols.get(column);
    if (!bType) continue; // declared in only one of the two
    if (aType !== bType) {
      drift.push(`${tableName}.${column}  →  ${a.label} says ${aType}, ${b.label} says ${bType}`);
    }
  }
}

const shared = [...a.tables.keys()].filter((t) => b.tables.has(t));

console.log("audit-schema-drift\n");
console.log(`  tables declared in both files: ${shared.length}`);
console.log(`    ${shared.sort().join(", ")}\n`);

if (drift.length) {
  console.log(`✗ Columns the two schemas disagree about: ${drift.length}`);
  for (const d of drift.sort()) console.log(`    ${d}`);
  console.error("\naudit-schema-drift: FAILED");
  process.exit(1);
}

console.log("✓ Columns the two schemas disagree about: none");
console.log("\naudit-schema-drift: ok");
