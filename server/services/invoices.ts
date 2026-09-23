/**
 * Invoices (v1.2 Phase 1C, CMP-07).
 *
 * A till sale gets a receipt. An invoice is issued when a sale goes on a tab
 * (money is owed, so there is something to ask for) or when a customer asks
 * for one — HMRC does not require a VAT invoice for a retail sale unless the
 * customer asks. Each new invoice takes the organisation's next number, the
 * payment terms in force that day, and the customer's name as it was.
 *
 * Status is never stored: it is worked out by the one rule in
 * shared/invoices/invoiceRules.ts from the credit record, so the Invoices
 * page, the PDF and the Credit List cannot drift apart.
 */
import { db } from "../db";
import {
  customers,
  invoices,
  orderCredit,
  orderItems,
  orders,
  organizations,
  products,
  type Invoice,
} from "@shared/schema";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { currentTradingDay, shiftIsoDate } from "@shared/time/tradingDay";
import {
  DEFAULT_PAYMENT_DAYS,
  dueDateFromTerms,
  formatInvoiceNumber,
  invoiceAmountDue,
  invoiceAmounts,
  invoiceStatus,
  nextInvoiceSequence,
  type InvoiceCreditState,
  type InvoiceStatus,
} from "@shared/invoices/invoiceRules";

type InvoiceTx = Pick<typeof db, "select" | "insert" | "update">;

export class InvoiceError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "INVOICE_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : num(v));

function amountsForOrder(
  order: { total: string | null; vatAmount: string | null; vatRate: string | null },
  orgVatRate: unknown,
) {
  return invoiceAmounts({
    total: num(order.total),
    vatAmount: numOrNull(order.vatAmount),
    vatRate: numOrNull(order.vatRate),
    orgVatRate: num(orgVatRate),
  });
}

async function numberedInvoiceFor(orderId: string, client: Pick<typeof db, "select">) {
  const [row] = await client
    .select()
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), isNotNull(invoices.sequenceNumber)))
    .limit(1);
  return row ?? null;
}

/**
 * Issues the order's numbered invoice, or returns the one it already has.
 *
 * Runs inside the caller's transaction. The organisation row is locked to take
 * the next number, which also serialises two issuers for the same order: the
 * second re-reads after the lock and finds the first one's invoice.
 *
 * An order re-completed after a manager's edit keeps its number; its amounts
 * follow the order, since the invoice is for what the customer was charged.
 */
export async function issueInvoiceForOrder(tx: InvoiceTx, orgId: string, orderId: string): Promise<Invoice> {
  const [order] = await tx
    .select({
      id: orders.id,
      orgId: orders.orgId,
      customerId: orders.customerId,
      total: orders.total,
      vatAmount: orders.vatAmount,
      vatRate: orders.vatRate,
    })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)))
    .limit(1);
  if (!order) throw new InvoiceError("Order not found", 404, "ORDER_NOT_FOUND");

  const [org] = await tx
    .select({
      prefix: organizations.invoicePrefix,
      startNumber: organizations.invoiceStartNumber,
      lastNumber: organizations.invoiceLastNumber,
      paymentTerms: organizations.paymentTerms,
      vatRate: organizations.defaultTaxRate,
      timezone: organizations.timezone,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .for("update")
    .limit(1);
  if (!org) throw new InvoiceError("Organization not found", 404, "ORG_NOT_FOUND");

  const amounts = amountsForOrder(order, org.vatRate);
  const existing = await numberedInvoiceFor(orderId, tx);
  if (existing) {
    if (num(existing.total) !== num(order.total) || num(existing.tax) !== amounts.tax) {
      const [updated] = await tx
        .update(invoices)
        .set({
          subtotal: String(amounts.subtotal),
          tax: String(amounts.tax),
          total: String(num(order.total)),
          vatRate: String(amounts.vatRate),
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, existing.id))
        .returning();
      return updated;
    }
    return existing;
  }

  const [customer] = order.customerId
    ? await tx
        .select({ name: customers.name })
        .from(customers)
        .where(and(eq(customers.id, order.customerId), eq(customers.orgId, orgId)))
        .limit(1)
    : [];

  const sequence = nextInvoiceSequence(org.lastNumber, org.startNumber);
  await tx.update(organizations).set({ invoiceLastNumber: sequence }).where(eq(organizations.id, orgId));

  const issuedOn = currentTradingDay(org.timezone ?? "Europe/London");
  const terms = org.paymentTerms?.trim() || `Net ${DEFAULT_PAYMENT_DAYS}`;
  const [created] = await tx
    .insert(invoices)
    .values({
      orgId,
      orderId,
      customerId: order.customerId,
      invoiceNumber: formatInvoiceNumber(org.prefix, sequence),
      sequenceNumber: sequence,
      subtotal: String(amounts.subtotal),
      tax: String(amounts.tax),
      total: String(num(order.total)),
      vatRate: String(amounts.vatRate),
      status: "sent",
      dueDate: dueDateFromTerms(issuedOn, terms),
      paymentTerms: terms,
      billingName: customer?.name ?? null,
    })
    .returning();
  return created;
}

/** A customer asked for an invoice: issue one (or return the one they have). */
export async function issueInvoiceOnRequest(orgId: string, orderId: string): Promise<Invoice> {
  return db.transaction((tx) => issueInvoiceForOrder(tx, orgId, orderId));
}

async function orgToday(orgId: string): Promise<{ today: string; vatRate: number }> {
  const [org] = await db
    .select({ timezone: organizations.timezone, vatRate: organizations.defaultTaxRate })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return { today: currentTradingDay(org?.timezone ?? "Europe/London"), vatRate: num(org?.vatRate) };
}

/** An invoice's VAT rate: its own, or for an older record the rate its figures imply. */
function invoiceVatRate(invoice: Invoice): number {
  if (invoice.vatRate != null) return num(invoice.vatRate);
  const subtotal = num(invoice.subtotal);
  return subtotal > 0 ? Math.round((num(invoice.tax) / subtotal) * 1000) / 10 : 0;
}

function creditState(row: { status: string; amountGiven: string; amountOutstanding: string } | undefined): InvoiceCreditState | null {
  if (!row) return null;
  return { status: row.status, amountGiven: num(row.amountGiven), amountOutstanding: num(row.amountOutstanding) };
}

/** An invoice written before numbering has no due date of its own: 30 days, as it was shown. */
function legacyDueDate(createdAt: Date | null | undefined): string {
  const iso = (createdAt ?? new Date()).toISOString().slice(0, 10);
  return shiftIsoDate(iso, DEFAULT_PAYMENT_DAYS);
}

export type InvoiceListRow = {
  id: string;
  invoiceNumber: string;
  orderId: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string;
  date: string;
  dueDate: string;
  total: number;
  subtotal: number;
  vat: number;
  vatRate: number;
  amountDue: number;
  status: InvoiceStatus;
  paymentTerms: string | null;
  paymentMethod: string;
  /** False for a tab sale from before numbering that has no invoice record yet. */
  hasGeneratedInvoice: boolean;
  items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
};

/**
 * The Invoices page: numbered invoices, plus every tab sale (a tab sale from
 * before numbering shows with the record or number it had). Plain till sales
 * are not listed — they have receipts. Invoices written for them before this
 * release are still reachable from the order, but are not chased here.
 */
export async function listInvoices(orgId: string): Promise<InvoiceListRow[]> {
  const { today, vatRate: orgVatRate } = await orgToday(orgId);

  const numbered = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), isNotNull(invoices.sequenceNumber)));
  const credits = await db
    .select({
      orderId: orderCredit.orderId,
      status: orderCredit.status,
      amountGiven: orderCredit.amountGiven,
      amountOutstanding: orderCredit.amountOutstanding,
    })
    .from(orderCredit)
    .where(eq(orderCredit.orgId, orgId));

  const creditByOrder = new Map(credits.map((c) => [c.orderId, c]));
  const numberedByOrder = new Map(numbered.filter((i) => i.orderId).map((i) => [i.orderId as string, i]));
  const orderIds = Array.from(new Set([...numberedByOrder.keys(), ...creditByOrder.keys()]));
  if (orderIds.length === 0) return [];

  // Pre-numbering invoice records, only for tab sales without a numbered one.
  const legacyIds = orderIds.filter((id) => !numberedByOrder.has(id));
  const legacy = legacyIds.length
    ? await db
        .select()
        .from(invoices)
        .where(and(inArray(invoices.orderId, legacyIds), isNull(invoices.sequenceNumber), eq(invoices.orgId, orgId)))
        .orderBy(invoices.createdAt)
    : [];
  const legacyByOrder = new Map<string, Invoice>();
  for (const inv of legacy) if (inv.orderId && !legacyByOrder.has(inv.orderId)) legacyByOrder.set(inv.orderId, inv);

  const orderRows = await db
    .select({ order: orders, customer: customers })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .where(and(eq(orders.orgId, orgId), inArray(orders.id, orderIds)))
    .orderBy(desc(orders.createdAt));

  const itemRows = await db
    .select({
      orderId: orderItems.orderId,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
      totalPrice: orderItems.totalPrice,
      name: products.name,
    })
    .from(orderItems)
    .leftJoin(products, eq(orderItems.productId, products.id))
    .where(inArray(orderItems.orderId, orderIds));
  const itemsByOrder = new Map<string, InvoiceListRow["items"]>();
  for (const item of itemRows) {
    if (!item.orderId) continue;
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push({
      name: item.name || "Item",
      quantity: Number(item.quantity),
      unitPrice: num(item.unitPrice),
      total: num(item.totalPrice),
    });
    itemsByOrder.set(item.orderId, list);
  }

  return orderRows.map(({ order, customer }) => {
    const invoice = numberedByOrder.get(order.id) ?? legacyByOrder.get(order.id) ?? null;
    const credit = creditState(creditByOrder.get(order.id));
    const createdAt = invoice?.createdAt ?? order.createdAt ?? new Date();
    const dueDate = invoice?.dueDate || legacyDueDate(order.createdAt);
    const fallback = amountsForOrder(order, orgVatRate);
    const total = invoice ? num(invoice.total) : num(order.total);
    const statusInput = { orderStatus: order.status, orderTotal: total, credit, dueDate, today };
    return {
      id: invoice?.id ?? order.id,
      invoiceNumber:
        invoice?.invoiceNumber ??
        `INV-${new Date(order.createdAt ?? new Date()).getFullYear()}-${order.id.slice(0, 8).toUpperCase()}`,
      orderId: order.id,
      customerId: order.customerId,
      customerName: invoice?.billingName || customer?.name || "Walk-in customer",
      customerEmail: customer?.email || "",
      date: new Date(createdAt).toISOString(),
      dueDate,
      total,
      subtotal: invoice ? num(invoice.subtotal) : fallback.subtotal,
      vat: invoice ? num(invoice.tax) : fallback.tax,
      vatRate: invoice ? invoiceVatRate(invoice) : fallback.vatRate,
      amountDue: invoiceAmountDue(statusInput),
      status: invoiceStatus(statusInput),
      paymentTerms: invoice?.paymentTerms ?? null,
      paymentMethod: order.paymentMethod,
      hasGeneratedInvoice: !!invoice,
      items: itemsByOrder.get(order.id) ?? [],
    };
  });
}

export type InvoiceDocument = {
  invoiceNumber: string;
  createdAt: Date;
  dueDate: string;
  subtotal: number;
  tax: number;
  vatRate: number;
  total: number;
  status: InvoiceStatus;
  paymentTerms: string | null;
  paymentMethod: string | null;
  orgId: string;
  orderId: string;
  customerId: string | null;
  billingName: string | null;
};

/**
 * What an invoice PDF shows, by invoice id or by order id, scoped to the org.
 *
 * By order id: the order's numbered invoice; otherwise, for a tab sale from
 * before numbering, its old record or one made up from the order, as before.
 * A plain till sale with no invoice returns `receiptOnly` — it has a receipt,
 * and an invoice is issued only when the customer asks.
 */
export async function loadInvoiceDocument(
  orgId: string,
  id: string,
): Promise<{ document: InvoiceDocument } | { receiptOnly: true } | null> {
  const { today, vatRate: orgVatRate } = await orgToday(orgId);

  let [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.orgId, orgId)))
    .limit(1);
  const orderId = invoice?.orderId ?? id;

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)))
    .limit(1);
  if (!order) return null;

  const [creditRow] = await db
    .select({
      status: orderCredit.status,
      amountGiven: orderCredit.amountGiven,
      amountOutstanding: orderCredit.amountOutstanding,
    })
    .from(orderCredit)
    .where(eq(orderCredit.orderId, order.id))
    .limit(1);
  const credit = creditState(creditRow);

  if (!invoice) {
    invoice = (await numberedInvoiceFor(order.id, db)) ?? undefined;
    if (!invoice && credit) {
      const [legacy] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.orderId, order.id), eq(invoices.orgId, orgId)))
        .orderBy(invoices.createdAt)
        .limit(1);
      invoice = legacy;
    }
    if (!invoice && !credit) return { receiptOnly: true };
  }

  const fallback = amountsForOrder(order, orgVatRate);
  const total = invoice ? num(invoice.total) : num(order.total);
  const dueDate = invoice?.dueDate || legacyDueDate(order.createdAt);
  const [customer] = order.customerId
    ? await db.select({ name: customers.name }).from(customers).where(eq(customers.id, order.customerId)).limit(1)
    : [];

  return {
    document: {
      invoiceNumber:
        invoice?.invoiceNumber ??
        `INV-${(order.createdAt ?? new Date()).getFullYear()}-${order.id.slice(0, 8).toUpperCase()}`,
      createdAt: invoice?.createdAt ?? order.createdAt ?? new Date(),
      dueDate,
      subtotal: invoice ? num(invoice.subtotal) : fallback.subtotal,
      tax: invoice ? num(invoice.tax) : fallback.tax,
      vatRate: invoice ? invoiceVatRate(invoice) : fallback.vatRate,
      total,
      status: invoiceStatus({ orderStatus: order.status, orderTotal: total, credit, dueDate, today }),
      paymentTerms: invoice?.paymentTerms ?? null,
      paymentMethod: order.paymentMethod,
      orgId,
      orderId: order.id,
      customerId: invoice?.customerId ?? order.customerId,
      billingName: invoice?.billingName ?? customer?.name ?? null,
    },
  };
}
