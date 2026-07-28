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

export function registerReportRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/reports", ...scoped, async (req: any, res) => {
    try {
      const { from, to } = req.query;
      
      // Validate date inputs
      if (!from || !to) {
        return res.status(400).json({ message: "Missing date range parameters" });
      }
      
      const fromDate = new Date(from);
      const toDate = new Date(to);
      
      // Check for valid dates
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }
      
      if (fromDate > toDate) {
        return res.status(400).json({ message: "From date must be before to date" });
      }
      
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const reportData = await storage.getReportData(fromDate, toDate, ctx.orgId);
      res.json(reportData);
    } catch (error) {
      console.error("Error fetching report data:", error);
      res.status(500).json({ message: "Failed to fetch report data" });
    }
  });

  app.get("/api/reports/export", ...scoped, async (req: any, res) => {
    try {
      const { from, to, format, type } = req.query;
      
      // Validate parameters
      if (!from || !to || !format || !type) {
        return res.status(400).json({ message: "Missing required parameters" });
      }
      
      const fromDate = new Date(from);
      const toDate = new Date(to);
      
      // Check for valid dates
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }
      
      // Validate format
      if (!['csv', 'pdf'].includes(format)) {
        return res.status(400).json({ message: "Invalid format. Must be csv or pdf" });
      }
      
      // Validate type
      if (!['revenue', 'orders', 'customers', 'inventory', 'full'].includes(type)) {
        return res.status(400).json({ message: "Invalid report type" });
      }
      
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const reportData = await storage.getReportData(fromDate, toDate, ctx.orgId);
      
      if (format === 'csv') {
        // Generate CSV
        const csv = await storage.generateCSVReport(reportData, type);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${type}_report.csv"`);
        res.send(csv);
      } else {
        // Real branded PDF (pdfkit) — previously this shipped CSV bytes as
        // application/pdf, producing a file that would not open.
        const period = `${fromDate.toISOString().slice(0, 10)} to ${toDate.toISOString().slice(0, 10)}`;
        const pdf = await storage.generatePDFReport(reportData, type, period);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="arcarna-${type}-${toDate.toISOString().slice(0, 10)}.pdf"`,
        );
        res.send(pdf);
      }
    } catch (error) {
      console.error("Error exporting report:", error);
      res.status(500).json({ message: "Failed to export report" });
    }
  });

  // Spec API endpoint: GET /api/reports/[ref]?from=&to=  → JSON report payload.
  // Registered AFTER the exact "/export" route so it only catches ARC-* refs.
  // (Express 5 dropped inline regex params, so the ARC- guard lives in-handler.)
  app.get("/api/reports/:ref", ...scoped, async (req: any, res, next) => {
    const { ref } = req.params;
    if (!/^ARC-/i.test(ref)) return next();
    try {
      const { from, to } = req.query;
      const opts: { from?: Date; to?: Date } = {};
      if (from) {
        const d = new Date(from);
        if (!isNaN(d.getTime())) opts.from = d;
      }
      if (to) {
        const d = new Date(to);
        if (!isNaN(d.getTime())) opts.to = d;
      }
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { runReport } = await import("../services/reportsEngine");
      const payload = await runReport(ref, ctx.orgId, opts);

      // DEVELOPER NOTE (spec): every red-flag condition writes a notification.
      if (payload.redFlags.length) {
        try {
          const { notifyReportRedFlags } = await import("../services/reportNotifications");
          await notifyReportRedFlags(ctx.orgId, payload);
        } catch (e) {
          console.error("report red-flag notification failed:", e);
        }
      }
      res.json(payload);
    } catch (error: any) {
      const status = error?.statusCode ?? 500;
      if (status === 404) return res.status(404).json({ message: error.message });
      console.error("Error running report:", error);
      res.status(500).json({ message: "Failed to run report" });
    }
  });

}
