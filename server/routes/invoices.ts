import type { Express, RequestHandler } from "express";
import { storage } from "../storage";

type InvoiceCompany = {
  name: string;
  address?: string;
  companyNumber?: string;
  vatNumber?: string;
  email?: string;
  logo?: Buffer;
  bankName?: string;
  bankSortCode?: string;
  bankAccountNumber?: string;
  paymentLink?: string;
  currency?: string;
};

type InvoicePdfData = {
  invoiceNumber: string;
  createdAt: Date;
  dueDate: string;
  subtotal: number;
  tax: number;
  total: number;
  status: string;
  paymentMethod: string | null;
  company: InvoiceCompany;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
};

/** Fetches the org's logo bytes for invoice branding, if enabled and configured. Never throws. */
async function loadInvoiceLogo(org: {
  invoiceLogoEnabled: boolean;
  logoUrl: string | null;
}): Promise<Buffer | undefined> {
  if (!org.invoiceLogoEnabled || !org.logoUrl) return undefined;
  try {
    const res = await fetch(org.logoUrl);
    if (!res.ok) return undefined;
    return Buffer.from(await res.arrayBuffer());
  } catch (error) {
    console.error("[Invoices] Failed to fetch invoice logo:", error);
    return undefined;
  }
}

function buildCompanyInfo(
  org: {
    name: string;
    tradingName: string | null;
    address: string | null;
    companyNumber: string | null;
    vatNumber: string | null;
    email: string | null;
    currency: string | null;
    invoiceBankName: string | null;
    invoiceBankSortCode: string | null;
    invoiceBankAccountNumber: string | null;
    invoicePaymentLink: string | null;
  },
  logo: Buffer | undefined,
): InvoiceCompany {
  return {
    name: org.tradingName || org.name,
    address: org.address || undefined,
    companyNumber: org.companyNumber || undefined,
    vatNumber: org.vatNumber || undefined,
    email: org.email || undefined,
    logo,
    bankName: org.invoiceBankName || undefined,
    bankSortCode: org.invoiceBankSortCode || undefined,
    bankAccountNumber: org.invoiceBankAccountNumber || undefined,
    paymentLink: org.invoicePaymentLink || undefined,
    currency: org.currency || "GBP",
  };
}

/**
 * Loads everything needed to render an invoice PDF, scoped to the caller's org.
 * Accepts either a real `invoices.id` or (for orders whose invoice record
 * hasn't been created by the async InvoiceWorker yet) an `orders.id` — in
 * that case the data is synthesized from the order directly using the org's
 * configured tax rate, matching storage.getInvoicesWithDetails.
 */
async function loadInvoiceForPdf(orgId: string | undefined, id: string): Promise<InvoicePdfData | null> {
  const { invoices, orders, orderItems, customers, products, organizations } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../db");

  const loadItems = async (orderId: string) =>
    db
      .select({
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
        totalPrice: orderItems.totalPrice,
        productName: products.name,
      })
      .from(orderItems)
      .leftJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, orderId));

  const toItems = (rows: Awaited<ReturnType<typeof loadItems>>, fallbackTotal: number) =>
    rows.length > 0
      ? rows.map((item) => ({
          name: item.productName || "Item",
          quantity: item.quantity,
          unitPrice: parseFloat(String(item.unitPrice ?? "0")),
          total: parseFloat(String(item.totalPrice ?? "0")),
        }))
      : [{ name: "Order total", quantity: 1, unitPrice: fallbackTotal, total: fallbackTotal }];

  const loadCompany = async (companyOrgId: string | null): Promise<InvoiceCompany> => {
    if (!companyOrgId) return { name: "Your business" };
    const [org] = await db.select().from(organizations).where(eq(organizations.id, companyOrgId)).limit(1);
    if (!org) return { name: "Your business" };
    const logo = await loadInvoiceLogo(org);
    return buildCompanyInfo(org, logo);
  };

  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (invoice?.orderId) {
    const [order] = await db.select().from(orders).where(eq(orders.id, invoice.orderId)).limit(1);
    if (!order || (orgId && order.orgId !== orgId)) return null;

    const [customer] = invoice.customerId
      ? await db.select().from(customers).where(eq(customers.id, invoice.customerId)).limit(1)
      : [null];
    const total = parseFloat(invoice.total || "0");

    return {
      invoiceNumber: invoice.invoiceNumber,
      createdAt: invoice.createdAt ?? new Date(),
      dueDate: invoice.dueDate || "",
      subtotal: parseFloat(invoice.subtotal || "0"),
      tax: parseFloat(String(invoice.tax ?? "0")),
      total,
      status: invoice.status || "sent",
      paymentMethod: order.paymentMethod,
      company: await loadCompany(order.orgId),
      customerName: customer?.name || undefined,
      customerEmail: customer?.email || undefined,
      customerPhone: customer?.phone || undefined,
      customerAddress: customer?.address || undefined,
      items: toItems(await loadItems(invoice.orderId), total),
    };
  }

  // No invoice record yet (e.g. InvoiceWorker hasn't processed this order's
  // event) — synthesize directly from the order so "View PDF" still works.
  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!order || (orgId && order.orgId !== orgId)) return null;

  const [customer] = order.customerId
    ? await db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1)
    : [null];

  const company = await loadCompany(order.orgId);
  let taxRate = 0.2;
  if (order.orgId) {
    const [org] = await db
      .select({ defaultTaxRate: organizations.defaultTaxRate })
      .from(organizations)
      .where(eq(organizations.id, order.orgId))
      .limit(1);
    if (org?.defaultTaxRate != null) taxRate = parseFloat(String(org.defaultTaxRate)) / 100;
  }

  const total = parseFloat(order.total);
  const subtotal = total / (1 + taxRate);
  const createdAt = order.createdAt ?? new Date();
  const dueDate = new Date(createdAt);
  dueDate.setDate(dueDate.getDate() + 30);

  return {
    invoiceNumber: `INV-${createdAt.getFullYear()}-${order.id.slice(0, 8).toUpperCase()}`,
    createdAt,
    dueDate: dueDate.toISOString().slice(0, 10),
    subtotal,
    tax: total - subtotal,
    total,
    status: order.status === "completed" ? "paid" : "pending",
    paymentMethod: order.paymentMethod,
    company,
    customerName: customer?.name || undefined,
    customerEmail: customer?.email || undefined,
    customerPhone: customer?.phone || undefined,
    customerAddress: customer?.address || undefined,
    items: toItems(await loadItems(order.id), total),
  };
}

export function registerInvoiceRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/invoices", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const invoices = await storage.getInvoicesWithDetails(ctx.orgId);
      res.json(invoices);
    } catch (error) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  // Generates the invoice PDF on demand and streams it back — no external
  // storage involved, Neon already has everything the PDF needs.
  app.get("/api/invoices/:id/pdf", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const data = await loadInvoiceForPdf(ctx?.orgId, req.params.id);
      if (!data) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const { generateInvoicePdf } = await import("../services/pdfGenerator");
      const pdfBuffer = await generateInvoicePdf({
        invoiceNumber: data.invoiceNumber,
        createdAt: data.createdAt.toISOString(),
        dueDate: data.dueDate,
        company: data.company,
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        customerPhone: data.customerPhone,
        customerAddress: data.customerAddress,
        items: data.items,
        subtotal: data.subtotal,
        tax: data.tax,
        total: data.total,
        status: data.status,
        paymentMethod: data.paymentMethod || undefined,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${data.invoiceNumber}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating invoice PDF:", error);
      const message = error instanceof Error ? error.message : "Failed to generate invoice PDF";
      res.status(500).json({ message });
    }
  });
}
