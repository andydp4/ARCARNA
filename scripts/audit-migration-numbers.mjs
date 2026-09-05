#!/usr/bin/env node
/**
 * Two migrations must not share a number.
 *
 * `apply-migrations-pm2.sh` runs `migrations/*.sql` through `sort -V`. Given
 * two files numbered the same, the tie is broken on the description that
 * follows — so the order two migrations run in is decided by their prose,
 * alphabetically, which is not something anyone would think to check.
 *
 * It happened twice: a branch developed alongside main picked 038 and 039,
 * both already taken. Those pairs turned out to be independent, so nothing
 * broke. The next pair might not be.
 *
 * The 001 pair is exempt by design: both are conditional analytics variants an
 * operator runs by hand, and the apply script skips them (MANUAL_ONLY).
 */
import { readdirSync } from "node:fs";

const MANUAL_ONLY = new Set([
  "001_analytics_org_pk.sql",
  "001_analytics_org_pk_with_org.sql",
]);

const byNumber = new Map();
for (const file of readdirSync("migrations").filter((f) => f.endsWith(".sql"))) {
  if (MANUAL_ONLY.has(file)) continue;
  const match = /^(\d+)_/.exec(file);
  if (!match) {
    console.error(`audit-migration-numbers: ${file} does not start with a number`);
    process.exit(1);
  }
  const number = match[1];
  byNumber.set(number, [...(byNumber.get(number) ?? []), file]);
}

const clashes = [...byNumber.entries()].filter(([, files]) => files.length > 1);

if (clashes.length > 0) {
  console.error("audit-migration-numbers: two migrations share a number\n");
  for (const [number, files] of clashes) {
    console.error(`  ${number}:`);
    for (const f of files.sort()) console.error(`    ${f}`);
  }
  console.error(
    "\nThe apply script sorts by version, so these would run in alphabetical" +
      "\norder of their descriptions. Renumber the later one to the next free" +
      "\nslot — the files are idempotent, so re-running under a new name is safe.",
  );
  process.exit(1);
}

console.log(`audit-migration-numbers: ok (${byNumber.size} numbered migrations, no clashes)`);
