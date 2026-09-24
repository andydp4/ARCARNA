/**
 * Checks arcarna's money figures against the orders they come from.
 *
 *   npx tsx scripts/reconcile-figures.ts [--days 30] [--org <org id>] [--no-days]
 *
 * For each organisation it recomputes, from the source rows, the last N
 * trading days (06:00 to 06:00 local): takings, the 06:00 close, every till
 * drawer's expected cash, the cashier shift sheets and the Credit List, and
 * prints in plain English anything that does not add up.
 *
 * Safe to run on the live server at any time:
 *  - READ ONLY. Every query runs in one read-only transaction that is rolled
 *    back; Postgres refuses any write.
 *  - Prints no customer contact details — orders are named by short code.
 *
 * Exit code 0 when everything matches, 1 when something does not, 2 when the
 * check itself could not run.
 */
import {
  formatReconciliation,
  reconcileFigures,
  totalProblems,
  withReadOnlyDb,
} from "../server/lib/reconcileFigures";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. On the server: set -a && source .env && set +a");
    return 2;
  }
  const days = Number(arg("--days") ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    console.error("--days must be a whole number from 1 to 366");
    return 2;
  }
  const orgId = arg("--org");
  const reports = await withReadOnlyDb(url, (db) => reconcileFigures(db, { days, orgId }));
  if (reports.length === 0) {
    console.error(orgId ? `No organisation with id ${orgId}.` : "No organisations found.");
    return 2;
  }
  console.log(formatReconciliation(reports, { showDays: !process.argv.includes("--no-days") }));
  return totalProblems(reports) === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("The figures check could not run:", error instanceof Error ? error.message : error);
    process.exit(2);
  });
