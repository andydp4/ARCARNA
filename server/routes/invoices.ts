import type { Express, RequestHandler } from "express";
import { requireRole } from "../auth";
import { rolesAtLeast } from "@shared/accessPolicy";
import { CREDIT_MIN_ROLE } from "@shared/creditPolicy";
import { loadCompanyInfo, type CompanyInfo as InvoiceCompany } from "../services/companyBranding";

type InvoicePdfData = {
  invoiceNumber: string;
  createdAt: Date;
  dueDate: string;
  subtotal: number;
  discount: number;
  tax: number;
  vatRate: number;
  pointsDiscount: number;
  total: number;
  status: string;
  paymentTerms: string | null;
  paymentMethod: string | null;
  company: InvoiceCompany;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
};

/**
 * Everything an invoice PDF needs, scoped to the caller's org. Accepts an
 * invoice id or an order id (the order screen's "Invoice" button). Which
 * invoice an order has, and its status, come from server/services/invoices.ts
 * (v1.2 Phase 1C). A plain till sale with no invoice is `receiptOnly`.
 */
async function loadInvoiceForPdf(
  orgId: string,
  id: string,
): Promise<InvoicePdfData | { receiptOnly: true } | null> {
  const { orderItems, customers, products } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../db");
  const { loadInvoiceDocument } = await import("../services/invoices");
  const { INVOICE_STATUS_LABELS } = await import("@shared/invoices/invoiceRules");

  const loaded = await loadInvoiceDocument(orgId, id);
  if (!loaded || "receiptOnly" in loaded) return loaded;
  const doc = loaded.document;

  const itemRows = await db
    .select({
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
      totalPrice: orderItems.totalPrice,
      productName: products.name,
    })
    .from(orderItems)
    .leftJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, doc.orderId));
  const items =
    itemRows.length > 0
      ? itemRows.map((item) => ({
          name: item.productName || "Item",
          quantity: item.quantity,
          unitPrice: parseFloat(String(item.unitPrice ?? "0")),
          total: parseFloat(String(item.totalPrice ?? "0")),
        }))
      : [{ name: "Order total", quantity: 1, unitPrice: doc.total, total: doc.total }];

  // A VAT invoice needs the name and the billing address, nothing else
  // (v1.2 Phase 5): no email or phone on the PDF.
  const [customer] = doc.customerId
    ? await db
        .select({ name: customers.name, address: customers.address })
        .from(customers)
        .where(eq(customers.id, doc.customerId))
        .limit(1)
    : [null];

  return {
    invoiceNumber: doc.invoiceNumber,
    createdAt: doc.createdAt,
    dueDate: doc.dueDate,
    subtotal: doc.subtotal,
    discount: doc.discount,
    tax: doc.tax,
    pointsDiscount: doc.pointsDiscount,
    vatRate: doc.vatRate,
    total: doc.total,
    status: INVOICE_STATUS_LABELS[doc.status],
    paymentTerms: doc.paymentTerms,
    paymentMethod: doc.paymentMethod,
    company: await loadCompanyInfo(orgId),
    // Made out to the name the invoice was issued to, not whatever the
    // customer record says today.
    customerName: doc.billingName || customer?.name || undefined,
    customerAddress: customer?.address || undefined,
    items,
  };
}

export function registerInvoiceRoutes(app: Express, scoped: RequestHandler[]): void {
  // Invoices carry the customer's name, billing address and what they owe:
  // manager and above, like the Credit List (owner decision Q11). The list's
  // email is admin only (Q13a); managers get the mask.
  const invoiceRoles = requireRole(...rolesAtLeast(CREDIT_MIN_ROLE));

  app.get("/api/invoices", ...scoped, invoiceRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { listInvoices } = await import("../services/invoices");
      res.json(await listInvoices(ctx.orgId, ctx.role));
    } catch (error) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  // A customer asked for an invoice for a sale (v1.2 Phase 1C): a till sale
  // gets a receipt unless they do. Issues the next number once; asking again
  // returns the same invoice.
  app.post("/api/invoices/for-order/:orderId", ...scoped, invoiceRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null };
      if (!ctx?.orgId) return res.status(403).json({ message: "Organization scope required" });
      const { issueInvoiceOnRequest } = await import("../services/invoices");
      const invoice = await issueInvoiceOnRequest(ctx.orgId, req.params.orderId);
      res.status(201).json({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, dueDate: invoice.dueDate });
    } catch (error) {
      const err = error as { status?: number; code?: string; message?: string };
      if (err?.status && err.code) return res.status(err.status).json({ message: err.message, code: err.code });
      console.error("Error issuing invoice:", error);
      res.status(500).json({ message: "Failed to issue the invoice" });
    }
  });

  // Generates the invoice PDF on demand and streams it back — no external
  // storage involved, Neon already has everything the PDF needs.
  app.get("/api/invoices/:id/pdf", ...scoped, invoiceRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      if (!ctx?.orgId) return res.status(403).json({ message: "Organization scope required" });
      const data = await loadInvoiceForPdf(ctx.orgId, req.params.id);
      if (!data) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      if ("receiptOnly" in data) {
        return res.status(404).json({
          message: "This sale has a receipt, not an invoice. Issue an invoice if the customer asks for one.",
          code: "INVOICE_NOT_ISSUED",
        });
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
        discount: data.discount,
        tax: data.tax,
        pointsDiscount: data.pointsDiscount,
        vatRate: data.vatRate,
        total: data.total,
        status: data.status,
        paymentTerms: data.paymentTerms || undefined,
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
