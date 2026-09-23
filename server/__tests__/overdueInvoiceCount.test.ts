/**
 * The assistant's "N invoices overdue" alert counts only invoices for sales
 * put on credit (the tick / account list) that still have money outstanding
 * past their due date (FIX-15). Every till sale gets an invoice as 'sent' and
 * nothing marks one 'paid', so counting invoices alone grew without end.
 * Needs a database; in CI's unit-db job by explicit file name.
 */
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("overdueInvoiceCount", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  const orgId = randomUUID();
  const otherOrgId = randomUUID();

  async function sale(opts: {
    org?: string;
    due: string;
    credit?: { status: string; outstanding: string };
  }) {
    const org = opts.org ?? orgId;
    const orderId = randomUUID();
    await db.insert(schema.orders).values({
      id: orderId,
      orgId: org,
      total: "20.00",
      paymentMethod: opts.credit ? "tick" : "cash",
      status: "completed",
    } as never);
    await db.insert(schema.invoices).values({
      orgId: org,
      orderId,
      invoiceNumber: `INV-${orderId.slice(0, 8)}`,
      subtotal: "20.00",
      total: "20.00",
      status: "sent",
      dueDate: opts.due,
    });
    if (opts.credit) {
      await db.insert(schema.orderCredit).values({
        orderId,
        orgId: org,
        amountGiven: "20.00",
        amountOutstanding: opts.credit.outstanding,
        status: opts.credit.status,
        givenOn: "2026-01-01",
      });
    }
  }

  beforeAll(async () => {
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    await db.insert(schema.organizations).values([
      { id: orgId, name: "ZZ Overdue Invoices Test" },
      { id: otherOrgId, name: "ZZ Overdue Invoices Other" },
    ]);
    // Counted: on credit, still owed, past due.
    await sale({ due: "2026-08-01", credit: { status: "outstanding", outstanding: "20.00" } });
    await sale({ due: "2026-08-02", credit: { status: "partial", outstanding: "5.00" } });
    // Not counted: an ordinary paid-at-the-till sale (no credit row).
    await sale({ due: "2026-08-01" });
    await sale({ due: "2026-08-01" });
    // Not counted: credit settled / written off.
    await sale({ due: "2026-08-01", credit: { status: "settled", outstanding: "0.00" } });
    await sale({ due: "2026-08-01", credit: { status: "written_off", outstanding: "20.00" } });
    // Not counted: owed but not yet due.
    await sale({ due: "2026-10-30", credit: { status: "outstanding", outstanding: "20.00" } });
    // Not counted: another org's debt.
    await sale({ org: otherOrgId, due: "2026-08-01", credit: { status: "outstanding", outstanding: "20.00" } });
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      await db.delete(schema.invoices).where(eq(schema.invoices.orgId, org));
      await db.delete(schema.orderCredit).where(eq(schema.orderCredit.orgId, org));
      await db.delete(schema.orders).where(eq(schema.orders.orgId, org));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, org));
    }
  });

  it("counts only credit/account invoices still owed past their due date", async () => {
    const { overdueInvoiceCount } = await import("../assistant/alerts");
    expect(await overdueInvoiceCount(orgId, "2026-09-23")).toBe(2);
    expect(await overdueInvoiceCount(otherOrgId, "2026-09-23")).toBe(1);
  });
});
