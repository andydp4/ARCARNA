/**
 * v1.2.1 money audit (M15): an invoice for a sale refunded in part still read
 * as the full total, paid, with no refund anywhere on it. It now carries what
 * was refunded (the list, the document and the PDF show it under the total).
 */
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { customers, orderCredit, orders, organizations, refunds } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("invoices show refunds", () => {
  let db: (typeof import("../db"))["db"];
  let invoicesSvc: typeof import("../services/invoices");
  let orgId: string;
  let orderId: string;

  beforeEach(async () => {
    ({ db } = await import("../db"));
    invoicesSvc = await import("../services/invoices");
    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Invoice Refunds Test" } as never);
    const [c] = await db.insert(customers).values({ orgId, name: "Bea Example" } as never).returning();
    const [o] = await db
      .insert(orders)
      .values({ orgId, customerId: c.id, total: "50.00", settledTotal: "50.00", paymentMethod: "tick", status: "completed", vatRate: "0", vatAmount: "0" } as never)
      .returning();
    orderId = o.id;
    await db.insert(orderCredit).values({ orderId, orgId, customerId: c.id, amountGiven: "50.00", amountOutstanding: "0", status: "settled", givenOn: "2026-09-14" });
    await db.insert(refunds).values({ orderId, orgId, cashierId: "u", reason: "damaged", refundMethod: "cash", total: "25.00" });
  });

  afterEach(async () => {
    await db.delete(refunds).where(eq(refunds.orgId, orgId));
    await db.delete(orderCredit).where(eq(orderCredit.orgId, orgId));
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(customers).where(eq(customers.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("the Invoices list carries what was refunded", async () => {
    const rows = await invoicesSvc.listInvoices(orgId, "ADMIN");
    const row = rows.find((r) => r.orderId === orderId)!;
    expect(row.total).toBe(50);
    expect(row.refunded).toBe(25);
  });

  it("the invoice document (and so its PDF) carries it too", async () => {
    const loaded = await invoicesSvc.loadInvoiceDocument(orgId, orderId);
    expect(loaded && "document" in loaded ? loaded.document.refunded : null).toBe(25);
  });
});
