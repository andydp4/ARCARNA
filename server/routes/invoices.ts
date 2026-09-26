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
  deliveryFee: number;
  deliveryFeeName: string;
  total: number;
  refunded: number;
  status: string;
  paymentTerms: string | null;
  paymentMethod: string | null;
  company: InvoiceCompany;
  customerId: string | null;
  customerName?: string;
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
    deliveryFee: doc.deliveryFee,
    deliveryFeeName: doc.deliveryFeeName,
    vatRate: doc.vatRate,
    total: doc.total,
    refunded: doc.refunded,
    status: INVOICE_STATUS_LABELS[doc.status],
    paymentTerms: doc.paymentTerms,
    paymentMethod: doc.paymentMethod,
    company: await loadCompanyInfo(orgId),
    customerId: doc.customerId ?? null,
    // Made out to the name the invoice was issued to, not whatever the
    // customer record says today.
    customerName: doc.billingName || customer?.name || undefined,
    customerAddress: customer?.address || undefined,
    items,
  };
}

async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const { generateInvoicePdf } = await import("../services/pdfGenerator");
  return generateInvoicePdf({
    invoiceNumber: data.invoiceNumber,
    createdAt: data.createdAt.toISOString(),
    dueDate: data.dueDate,
    company: data.company,
    customerName: data.customerName,
    customerAddress: data.customerAddress,
    items: data.items,
    subtotal: data.subtotal,
    discount: data.discount,
    tax: data.tax,
    pointsDiscount: data.pointsDiscount,
    deliveryFee: data.deliveryFee,
    deliveryFeeName: data.deliveryFeeName,
    vatRate: data.vatRate,
    total: data.total,
    refunded: data.refunded,
    status: data.status,
    paymentTerms: data.paymentTerms || undefined,
    paymentMethod: data.paymentMethod || undefined,
  });
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

      const pdfBuffer = await renderInvoicePdf(data);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${data.invoiceNumber}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating invoice PDF:", error);
      const message = error instanceof Error ? error.message : "Failed to generate invoice PDF";
      res.status(500).json({ message });
    }
  });

  /**
   * Email the invoice to the customer from the server, through Resend (v1.2
   * Phase 6, PRV-11). Nobody on the till needs the address: the server reads
   * it, sends, logs the send in the customer data access log, and answers
   * with the mask. When email is not set up the app shows the button off with
   * the reason; this answers 409 with the same reason.
   */
  app.post("/api/invoices/:id/email", ...scoped, invoiceRoles, async (req: any, res) => {
    res.setHeader("Cache-Control", "no-store, private");
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      if (!ctx?.orgId) return res.status(403).json({ message: "Organization scope required" });
      const { EMAIL_NOT_SET_UP } = await import("@shared/contactAccess");
      const apiKey = process.env.RESEND_API_KEY?.trim();
      if (!apiKey) return res.status(409).json({ message: EMAIL_NOT_SET_UP, code: "EMAIL_NOT_SET_UP" });
      const data = await loadInvoiceForPdf(ctx.orgId, req.params.id);
      if (!data) return res.status(404).json({ message: "Invoice not found" });
      if ("receiptOnly" in data) {
        return res.status(404).json({ message: "This sale has a receipt, not an invoice.", code: "INVOICE_NOT_ISSUED" });
      }
      if (!data.customerId) return res.status(409).json({ message: "This invoice has no customer to send it to.", code: "NO_CUSTOMER" });
      const { readContactField } = await import("../services/customerView");
      const email = await readContactField(ctx.orgId, data.customerId, "email");
      if (!email.value) return res.status(409).json({ message: "There is no email on file for this customer.", code: "NO_EMAIL" });
      const { maskEmail } = await import("@shared/customerView");
      const { recordAccessFromRequest } = await import("../services/customerAccessLog");
      // Logged before it goes: no log, no email.
      try {
        await recordAccessFromRequest(req, {
          orgId: ctx.orgId,
          customerId: data.customerId,
          action: "invoice_emailed",
          metadata: { invoiceNumber: data.invoiceNumber, channel: "email" },
        });
      } catch (error) {
        console.error("[Invoices] email log failed; not sending:", error);
        return res.status(503).json({ message: "This could not be logged, so it was not sent. Try again in a moment.", code: "LOG_FAILED" });
      }
      const pdf = await renderInvoicePdf(data);
      const { Resend } = await import("resend");
      const from =
        process.env.INVOICE_FROM_EMAIL?.trim() ||
        process.env.RECEIPT_FROM_EMAIL?.trim() ||
        process.env.RESEND_FROM_EMAIL?.trim() ||
        "invoices@arcarna.local";
      const shop = data.company?.name || "us";
      const sent = await new Resend(apiKey).emails.send({
        from,
        to: email.value,
        subject: `Invoice ${data.invoiceNumber} from ${shop}`,
        html: `<p>Hello${data.customerName ? ` ${data.customerName.split(/\s+/)[0]}` : ""},</p><p>Your invoice ${data.invoiceNumber} is attached. Total £${data.total.toFixed(2)}, due ${data.dueDate}.</p><p>Thank you,<br/>${shop}</p>`,
        attachments: [{ filename: `${data.invoiceNumber}.pdf`, content: pdf }],
      });
      if (sent.error) return res.status(502).json({ message: "The email service did not accept it. Try again later.", code: "SEND_FAILED" });
      res.json({ sent: true, to: maskEmail(email.value) });
    } catch (error) {
      console.error("Error emailing invoice:", error);
      res.status(500).json({ message: "Failed to email the invoice" });
    }
  });
}
