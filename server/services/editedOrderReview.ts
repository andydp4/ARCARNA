/**
 * The one-off review list of past edited orders (v1.2 Phase 1B, "Manager
 * edits"; run by scripts/list-edited-orders.ts). Read-only.
 *
 * Before this release a manager's edit dropped the sale's discounts, left the
 * payment record at the old total (so a tick sale's Credit List amount could
 * disagree with the order), and until Sept 2026 added 20% VAT whatever the
 * shop's rate. Each edit published an `OrderUpdated` event, which is how the
 * edited orders are found; edits from now on also write an "edited" order
 * event. Orders whose total is exactly their lines plus 20% at a shop whose
 * rate is lower are listed too, even if their event has gone: that total can
 * only have come from the old edit.
 */
import { sql } from "drizzle-orm";

export type EditedOrderRow = {
  orgId: string;
  orgName: string | null;
  orgVatRate: string | null;
  orderId: string;
  invoiceNumber: string | null;
  createdAt: string | Date | null;
  status: string | null;
  paymentMethod: string;
  customerName: string | null;
  total: string;
  linesTotal: string | null;
  paymentsTotal: string | null;
  paymentLegs: number;
  creditGiven: string | null;
  creditStatus: string | null;
  editCount: number;
  lastEditedAt: string | Date | null;
  foundBy: string;
};

export type EditedOrderFlag = "gained_20pct_vat" | "payments_differ" | "credit_differs" | "discounts_unknown";

const cents = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/** Why an edited order needs a look. Pure. */
export function reviewFlags(row: Pick<
  EditedOrderRow,
  "total" | "linesTotal" | "orgVatRate" | "paymentsTotal" | "paymentLegs" | "creditGiven" | "creditStatus" | "paymentMethod"
>): EditedOrderFlag[] {
  const flags: EditedOrderFlag[] = [];
  const total = cents(row.total) ?? 0;
  const lines = cents(row.linesTotal);
  const rate = row.orgVatRate === null ? null : Number(row.orgVatRate);
  if (lines !== null && lines > 0 && Math.abs(Math.round(lines * 1.2) - total) <= 1 && (rate === null || rate < 20)) {
    flags.push("gained_20pct_vat");
  }
  const payments = cents(row.paymentsTotal);
  if (row.paymentLegs > 0 && payments !== null && Math.abs(payments - total) > 0) {
    flags.push("payments_differ");
  }
  const credit = cents(row.creditGiven);
  if (credit !== null && row.creditStatus !== "voided") {
    // A single tick leg (or no legs at all on an old order) means the whole
    // total is owed.
    const tickWhole = row.paymentLegs <= 1 && row.paymentMethod.toLowerCase() === "tick";
    if (tickWhole && credit !== total) flags.push("credit_differs");
  }
  if (lines !== null && total < lines - 1 && !flags.includes("gained_20pct_vat")) {
    // Money was taken off an order before discounts were recorded; the old
    // edit put it back.
    flags.push("discounts_unknown");
  }
  return flags;
}

export async function listEditedOrders(db: any, opts: { orgId?: string | null } = {}): Promise<EditedOrderRow[]> {
  const orgFilter = opts.orgId ? sql`AND o.org_id = ${opts.orgId}::uuid` : sql``;
  const result = await db.execute(sql`
    WITH edits AS (
      SELECT correlation_id::uuid AS order_id, count(*)::int AS n, max(occurred_at) AS last_at
      FROM event_outbox
      WHERE event_type = 'OrderUpdated'
        AND correlation_id ~ '^[0-9a-fA-F-]{36}$'
      GROUP BY correlation_id
      UNION ALL
      SELECT order_id, count(*)::int, max(at)
      FROM order_events
      WHERE kind = 'edited'
      GROUP BY order_id
    ),
    edit_totals AS (
      -- max, not sum: an edit from now on writes both an OrderUpdated event
      -- and an "edited" order event.
      SELECT order_id, max(n)::int AS n, max(last_at) AS last_at FROM edits GROUP BY order_id
    ),
    lines AS (
      SELECT order_id, sum(total_price) AS lines_total FROM order_items GROUP BY order_id
    ),
    legs AS (
      SELECT order_id, sum(amount) AS payments_total, count(*)::int AS legs FROM order_payments GROUP BY order_id
    )
    SELECT
      o.org_id AS "orgId",
      org.name AS "orgName",
      org.default_tax_rate::text AS "orgVatRate",
      o.id AS "orderId",
      (SELECT i.invoice_number FROM invoices i WHERE i.order_id = o.id ORDER BY i.created_at LIMIT 1) AS "invoiceNumber",
      o.created_at AS "createdAt",
      o.status,
      o.payment_method AS "paymentMethod",
      c.name AS "customerName",
      o.total::text AS total,
      l.lines_total::text AS "linesTotal",
      g.payments_total::text AS "paymentsTotal",
      COALESCE(g.legs, 0) AS "paymentLegs",
      oc.amount_given::text AS "creditGiven",
      oc.status AS "creditStatus",
      COALESCE(e.n, 0) AS "editCount",
      e.last_at AS "lastEditedAt",
      CASE WHEN e.order_id IS NOT NULL THEN 'edit event' ELSE 'total is lines + 20%' END AS "foundBy"
    FROM orders o
    JOIN organizations org ON org.id = o.org_id
    LEFT JOIN edit_totals e ON e.order_id = o.id
    LEFT JOIN lines l ON l.order_id = o.id
    LEFT JOIN legs g ON g.order_id = o.id
    LEFT JOIN order_credit oc ON oc.order_id = o.id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE (
      e.order_id IS NOT NULL
      OR (
        l.lines_total > 0
        AND abs(round(l.lines_total * 1.2, 2) - o.total) <= 0.01
        AND COALESCE(org.default_tax_rate, 0) < 20
        AND COALESCE(o.vat_rate, 0) < 20
      )
    )
    ${orgFilter}
    ORDER BY o.org_id, o.created_at
  `);
  return (result.rows ?? result) as EditedOrderRow[];
}
