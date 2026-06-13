import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { isAuthenticated, isOwner, requireRole, requireOrgContext, requireOrgScope, requireSuperAdminMfa } from "../auth";
import { getAuthRuntimeSnapshot, getAuthProvider } from "../authRuntime";
import { canAssignRole, canManageUser, isRole } from "@shared/rbac";
import type { Role } from "@shared/schema";
import { recordAdminAudit } from "../adminAudit";
import {
  insertLoyaltyTierSchema,
  insertPromotionSchema,
  insertOrderSchema,
  insertCustomerSchema,
  insertProductSchema,
  insertOverheadExpenseSchema,
  insertOrderExpenseSchema,
} from "@shared/schema";

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

  app.get("/api/invoices/:id/pdf", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const invoiceId = req.params.id;
      const { invoices, orders } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      const { db } = await import('../db');
      let invoiceResult = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (ctx?.orgId && invoiceResult[0]) {
        const [order] = await db.select().from(orders).where(eq(orders.id, invoiceResult[0].orderId!)).limit(1);
        if (!order || order.orgId !== ctx.orgId) {
          invoiceResult = [];
        }
      }
      
      if (invoiceResult.length === 0) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }
      
      const invoice = invoiceResult[0];
      
      // If invoice has a Google Drive link, redirect to it
      if (invoice.googleDriveLink) {
        res.json({ 
          pdfUrl: invoice.googleDriveLink,
          invoiceNumber: invoice.invoiceNumber,
          googleDriveFileId: invoice.googleDriveFileId,
        });
        return;
      }
      
      // If no PDF exists yet, return info to regenerate
      res.status(202).json({ 
        message: "PDF not yet generated. It will be created when the order is processed.",
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      });
    } catch (error) {
      console.error("Error fetching invoice PDF:", error);
      res.status(500).json({ message: "Failed to fetch invoice PDF" });
    }
  });
  
  // Endpoint to regenerate invoice PDF
  app.post("/api/invoices/:id/regenerate-pdf", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const invoiceId = req.params.id;
      const { invoices, orders, orderItems, customers } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const { db } = await import('../db');
      const { generateInvoicePdf } = await import('../services/pdfGenerator');
      const { uploadPdfToDrive, createFolderIfNotExists } = await import('../services/googleDrive');
      let invoiceResult = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (ctx?.orgId && invoiceResult[0]) {
        const [order] = await db.select().from(orders).where(eq(orders.id, invoiceResult[0].orderId!)).limit(1);
        if (!order || order.orgId !== ctx.orgId) invoiceResult = [];
      }
      
      if (invoiceResult.length === 0) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }
      
      const invoice = invoiceResult[0];
      
      // Get order and customer details
      let orderData = null;
      let customerData = null;
      let itemsData: any[] = [];
      
      if (invoice.orderId) {
        const orderResult = await db.select().from(orders).where(eq(orders.id, invoice.orderId)).limit(1);
        if (orderResult.length > 0) {
          orderData = orderResult[0];
          
          // Get order items
          itemsData = await db.select().from(orderItems).where(eq(orderItems.orderId, invoice.orderId));
        }
      }
      
      if (invoice.customerId) {
        const customerResult = await db.select().from(customers).where(eq(customers.id, invoice.customerId)).limit(1);
        if (customerResult.length > 0) {
          customerData = customerResult[0];
        }
      }
      
      // Generate PDF with full customer details
      const pdfBuffer = await generateInvoicePdf({
        invoiceNumber: invoice.invoiceNumber,
        createdAt: invoice.createdAt?.toISOString() || new Date().toISOString(),
        dueDate: invoice.dueDate || '',
        customerName: customerData?.name || undefined,
        customerEmail: customerData?.email || undefined,
        customerPhone: customerData?.phone || undefined,
        customerAddress: customerData?.address || undefined,
        items: itemsData.length > 0 ? itemsData.map((item: any) => ({
          name: item.productName || 'Services rendered',
          quantity: item.quantity,
          unitPrice: parseFloat(item.unitPrice || '0'),
          total: parseFloat(item.lineTotal || '0'),
        })) : [{
          name: 'Services rendered',
          quantity: 1,
          unitPrice: parseFloat(invoice.total || '0'),
          total: parseFloat(invoice.total || '0'),
        }],
        subtotal: parseFloat(invoice.subtotal || '0'),
        tax: parseFloat(invoice.tax || '0'),
        total: parseFloat(invoice.total || '0'),
        status: invoice.status || 'sent',
        paymentMethod: orderData?.paymentMethod || undefined,
      });
      
      // Upload to Google Drive
      const folderId = await createFolderIfNotExists('ARCARNA EPOS Invoices');
      const uploadResult = await uploadPdfToDrive(pdfBuffer, `${invoice.invoiceNumber}.pdf`, folderId);
      
      // Update invoice with Google Drive info
      await db
        .update(invoices)
        .set({
          googleDriveFileId: uploadResult.fileId,
          googleDriveLink: uploadResult.webViewLink,
        })
        .where(eq(invoices.id, invoiceId));
      
      res.json({
        message: "PDF regenerated successfully",
        invoiceNumber: invoice.invoiceNumber,
        pdfUrl: uploadResult.webViewLink,
        googleDriveFileId: uploadResult.fileId,
      });
    } catch (error) {
      console.error("Error regenerating invoice PDF:", error);
      res.status(500).json({ message: "Failed to regenerate invoice PDF" });
    }
  });

  // Batch regenerate all invoices missing PDFs
  app.post("/api/invoices/regenerate-all-missing", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { invoices, orders, orderItems, customers } = await import('@shared/schema');
      const { eq, and, isNull } = await import('drizzle-orm');
      const { db } = await import('../db');
      const { generateInvoicePdf } = await import('../services/pdfGenerator');
      const { uploadPdfToDrive, createFolderIfNotExists } = await import('../services/googleDrive');
      let missingPdfInvoices = await db.select().from(invoices).where(isNull(invoices.googleDriveFileId));
      if (ctx?.orgId) {
        const orgOrderIds = (await db.select({ id: orders.id }).from(orders).where(eq(orders.orgId, ctx.orgId))).map(r => r.id);
        missingPdfInvoices = missingPdfInvoices.filter(inv => inv.orderId && orgOrderIds.includes(inv.orderId));
      }
      
      if (missingPdfInvoices.length === 0) {
        res.json({ 
          message: "All invoices already have PDFs",
          processed: 0,
          total: 0
        });
        return;
      }
      
      const folderId = await createFolderIfNotExists('ARCARNA EPOS Invoices');
      
      const results: Array<{ invoiceNumber: string; status: string; error?: string }> = [];
      
      for (const invoice of missingPdfInvoices) {
        try {
          // Get order and customer details
          let orderData = null;
          let customerData = null;
          let itemsData: any[] = [];
          
          if (invoice.orderId) {
            const orderResult = await db.select().from(orders).where(eq(orders.id, invoice.orderId)).limit(1);
            if (orderResult.length > 0) {
              orderData = orderResult[0];
              itemsData = await db.select().from(orderItems).where(eq(orderItems.orderId, invoice.orderId));
            }
          }
          
          if (invoice.customerId) {
            const customerResult = await db.select().from(customers).where(eq(customers.id, invoice.customerId)).limit(1);
            if (customerResult.length > 0) {
              customerData = customerResult[0];
            }
          }
          
          // Generate PDF with full customer details
          const pdfBuffer = await generateInvoicePdf({
            invoiceNumber: invoice.invoiceNumber,
            createdAt: invoice.createdAt?.toISOString() || new Date().toISOString(),
            dueDate: invoice.dueDate || '',
            customerName: customerData?.name || undefined,
            customerEmail: customerData?.email || undefined,
            customerPhone: customerData?.phone || undefined,
            customerAddress: customerData?.address || undefined,
            items: itemsData.length > 0 ? itemsData.map((item: any) => ({
              name: item.productName || 'Services rendered',
              quantity: item.quantity,
              unitPrice: parseFloat(item.unitPrice || '0'),
              total: parseFloat(item.totalPrice || '0'),
            })) : [{
              name: 'Services rendered',
              quantity: 1,
              unitPrice: parseFloat(invoice.total || '0'),
              total: parseFloat(invoice.total || '0'),
            }],
            subtotal: parseFloat(invoice.subtotal || '0'),
            tax: parseFloat(invoice.tax || '0'),
            total: parseFloat(invoice.total || '0'),
            status: invoice.status || 'sent',
            paymentMethod: orderData?.paymentMethod || undefined,
          });
          
          // Upload to Google Drive
          const uploadResult = await uploadPdfToDrive(pdfBuffer, `${invoice.invoiceNumber}.pdf`, folderId);
          
          // Update invoice with Google Drive info
          await db
            .update(invoices)
            .set({
              googleDriveFileId: uploadResult.fileId,
              googleDriveLink: uploadResult.webViewLink,
            })
            .where(eq(invoices.id, invoice.id));
          
          results.push({ invoiceNumber: invoice.invoiceNumber, status: 'success' });
        } catch (invoiceError: any) {
          results.push({ 
            invoiceNumber: invoice.invoiceNumber, 
            status: 'failed', 
            error: invoiceError.message 
          });
        }
      }
      
      const successful = results.filter(r => r.status === 'success').length;
      const failed = results.filter(r => r.status === 'failed').length;
      
      res.json({
        message: `Processed ${successful} invoices successfully, ${failed} failed`,
        processed: successful,
        failed,
        total: missingPdfInvoices.length,
        results,
      });
    } catch (error) {
      console.error("Error regenerating missing invoice PDFs:", error);
      res.status(500).json({ message: "Failed to regenerate missing invoice PDFs" });
    }
  });

}
