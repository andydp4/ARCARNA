import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { isAuthenticated, isOwner, requireRole, requireOrgContext, requireOrgScope, requireSuperAdminMfa } from "../auth";
import { getAuthRuntimeSnapshot, getAuthProvider } from "../authRuntime";
import { canAssignRole, canManageUser, isRole } from "@shared/rbac";
import type { Role } from "@shared/schema";
import { recordAdminAudit } from "../adminAudit";
import { EVIDENCE_MIN_ROLE, EXPORT_MIN_ROLE, evidenceRefMinRole, rolesAtLeast } from "@shared/accessPolicy";
import {
  insertLoyaltyTierSchema,
  insertPromotionSchema,
  insertOrderSchema,
  insertCustomerSchema,
  insertProductSchema,
  insertOverheadExpenseSchema,
  insertOrderExpenseSchema,
} from "@shared/schema";

// Evidence is manager and above; exports are admin only and logged (Q12).
const evidenceRoles = requireRole(...rolesAtLeast(EVIDENCE_MIN_ROLE));
const exportRoles = requireRole(...rolesAtLeast(EXPORT_MIN_ROLE));
/** Some Evidence sits above the manager line (Q12: managers' performance). */
const refRoles: RequestHandler = (req, res, next) => {
  const ref = String(req.params.ref ?? "");
  if (!/^ARC-/i.test(ref)) return next();
  return requireRole(...rolesAtLeast(evidenceRefMinRole(ref)))(req, res, next);
};

export function registerReportRoutes(app: Express, scoped: RequestHandler[]): void {
  /** People an Evidence page can be filtered by — names and ids only (STF-FN2). */
  app.get("/api/evidence/staff", ...scoped, evidenceRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      const { listEvidenceStaff } = await import("../services/evidenceStaff");
      res.json(await listEvidenceStaff(ctx.orgId, { userId: req.user?.id ?? null, role: ctx.role }));
    } catch (error) {
      console.error("Error listing Evidence staff:", error);
      res.status(500).json({ message: "Failed to list staff" });
    }
  });

  /**
   * The Evidence pages export PNG/PDF/CSV in the browser, so the server never
   * sees the file. The toolbar (admins only) records each export here first,
   * and does not export if this refuses (Q12: every export is logged).
   */
  app.post("/api/evidence/exports", ...scoped, exportRoles, async (req: any, res) => {
    try {
      const ref = String(req.body?.ref ?? "");
      const format = String(req.body?.format ?? "").toLowerCase();
      if (!/^ARC-T\d-\d{3}$/i.test(ref) || !["png", "jpeg", "pdf", "csv"].includes(format)) {
        return res.status(400).json({ message: "ref and format are required" });
      }
      const ctx = req.orgContext as { orgId: string; role: string };
      await recordAdminAudit(req, {
        actorUserId: req.user?.id ?? "unknown",
        actorRole: ctx.role,
        action: "export.evidence",
        targetType: "evidence",
        targetId: ref.toUpperCase(),
        orgId: ctx.orgId,
        metadata: { ref: ref.toUpperCase(), format, from: req.body?.from ?? null, to: req.body?.to ?? null },
      });
      res.status(204).end();
    } catch (error) {
      console.error("Error logging Evidence export:", error);
      res.status(500).json({ message: "Failed to log export" });
    }
  });

  app.get("/api/reports", ...scoped, evidenceRoles, async (req: any, res) => {
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

  app.get("/api/reports/export", ...scoped, exportRoles, async (req: any, res) => {
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

      // Every export is logged (Q12): it takes the business's figures off the premises.
      await recordAdminAudit(req, {
        actorUserId: req.user?.id ?? "unknown",
        actorRole: ctx.role,
        action: "export.evidence",
        targetType: "evidence",
        targetId: String(type),
        orgId: ctx.orgId,
        metadata: { type, format, from: fromDate.toISOString(), to: toDate.toISOString() },
      });

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
  app.get("/api/reports/:ref", ...scoped, evidenceRoles, refRoles, async (req: any, res, next) => {
    const { ref } = req.params;
    if (!/^ARC-/i.test(ref)) return next();
    try {
      const { from, to, locationId, staffId, cashierId } = req.query;
      // The staff filter is keyed on the person, not a cashier code (STF-FN2).
      // An old cashier-code link must not be answered org-wide under a label
      // that says it is one person's figures (ARC-026), so it is refused.
      if (typeof cashierId === "string" && cashierId) {
        return res.status(404).json({ message: "Filtering by cashier code is retired. Pick a member of staff instead." });
      }
      const opts: { from?: Date; to?: Date; locationId?: string; staffUserId?: string } = {};
      if (from) {
        const d = new Date(from);
        if (!isNaN(d.getTime())) opts.from = d;
      }
      if (to) {
        const d = new Date(to);
        if (!isNaN(d.getTime())) opts.to = d;
      }
      // ARC-026: an explicit ?locationId=/?staffId= scopes the report to
      // one location/person instead of the whole org. Neither falls back to
      // req.orgContext's own locationId (the caller's current shift/session
      // location) — that value already drives every other org-wide screen by
      // default, and silently reusing it here would scope a report the
      // caller never asked to scope.
      if (typeof locationId === "string" && locationId) opts.locationId = locationId;
      if (typeof staffId === "string" && staffId) opts.staffUserId = staffId;

      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { runReport, validateReportScope, ReportScopeError } = await import("../services/reportsEngine");
      if (opts.locationId || opts.staffUserId) {
        try {
          await validateReportScope(
            ctx.orgId,
            { locationId: opts.locationId, staffUserId: opts.staffUserId },
            { userId: req.user?.id ?? null, role: ctx.role },
          );
        } catch (scopeError) {
          if (scopeError instanceof ReportScopeError) {
            return res.status(scopeError.statusCode).json({ message: scopeError.message });
          }
          throw scopeError;
        }
      }
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
