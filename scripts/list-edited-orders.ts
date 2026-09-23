/**
 * One-off, read-only: the orders a manager edited before v1.2 Phase 1B, for
 * the owner to review (server/services/editedOrderReview.ts says what each
 * flag means). Nothing is changed; corrections are a separate decision.
 *
 *   set -a && source .env && set +a
 *   npx tsx scripts/list-edited-orders.ts              # table
 *   npx tsx scripts/list-edited-orders.ts --csv > edited-orders.csv
 *   npx tsx scripts/list-edited-orders.ts --org=<org uuid>
 *
 * Flags:
 *   gained_20pct_vat  total is exactly the lines + 20% at a shop charging less
 *                     (the old edit's VAT bug): the customer may have been
 *                     charged, or put on tick for, VAT that was never owed
 *   payments_differ   the payment record does not add up to the order total
 *   credit_differs    a tick sale's Credit List amount is not the order total
 *   discounts_unknown money was taken off before discounts were recorded
 */
import { db, pool } from "../server/db";
import { listEditedOrders, reviewFlags } from "../server/services/editedOrderReview";

const args = process.argv.slice(2);
const csv = args.includes("--csv");
const orgId = args.find((a) => a.startsWith("--org="))?.split("=")[1] ?? null;

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const rows = await listEditedOrders(db, { orgId });
  const out = rows.map((r) => ({ ...r, flags: reviewFlags(r).join(" ") }));
  if (csv) {
    const cols = [
      "orgName", "orgId", "orderId", "invoiceNumber", "createdAt", "status", "paymentMethod", "customerName",
      "total", "linesTotal", "orgVatRate", "paymentsTotal", "paymentLegs", "creditGiven", "creditStatus",
      "editCount", "lastEditedAt", "foundBy", "flags",
    ] as const;
    console.log(cols.join(","));
    for (const r of out) console.log(cols.map((c) => csvCell((r as Record<string, unknown>)[c])).join(","));
  } else {
    console.log(`${out.length} edited order(s)${orgId ? ` for org ${orgId}` : ""}. Read-only; nothing was changed.\n`);
    console.table(
      out.map((r) => ({
        shop: r.orgName,
        invoice: r.invoiceNumber ?? String(r.orderId).slice(0, 8),
        status: r.status,
        paid: r.paymentMethod,
        customer: r.customerName,
        total: r.total,
        lines: r.linesTotal,
        payments: r.paymentsTotal,
        credit: r.creditGiven,
        edits: r.editCount,
        found: r.foundBy,
        flags: r.flags,
      })),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await (pool as { end?: () => Promise<void> }).end?.();
  });
