import type { Express } from "express";
import { storage } from "../storage";
import { isAuthenticated, requireOrgContext, requireOrgScope, requireRole } from "../auth";
import {
  orgProfilePatchSchema,
  PRODUCT_IMPORT_CSV_SAMPLE,
  CUSTOMER_IMPORT_CSV_SAMPLE,
} from "@shared/setup";
import { parseSpreadsheet, applyColumnMapping } from "../import/spreadsheet";
import { previewProductImport } from "../import/productImport";
import { previewCustomerImport, previewVcardCustomerImport } from "../import/customerImport";
import { products } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";

const setupScoped = [
  isAuthenticated,
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
  requireOrgContext,
  requireOrgScope,
];

const importScoped = [
  isAuthenticated,
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
  requireOrgContext,
  requireOrgScope,
];

const TEMPLATES: Record<string, { filename: string; content: string }> = {
  products: {
    filename: "products-template.csv",
    content: PRODUCT_IMPORT_CSV_SAMPLE,
  },
  customers: {
    filename: "customers-template.csv",
    content: CUSTOMER_IMPORT_CSV_SAMPLE,
  },
};

export function registerSetupAndImportRoutes(app: Express) {
  app.get("/api/org/setup", ...setupScoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const org = await storage.getOrgProfile(ctx.orgId);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      res.json(org);
    } catch (error) {
      console.error("Error fetching org setup:", error);
      res.status(500).json({ message: "Failed to fetch organization setup" });
    }
  });

  app.patch("/api/org/setup", ...setupScoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const parsed = orgProfilePatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid profile data", errors: parsed.error.errors });
      }
      const org = await storage.updateOrgProfile(ctx.orgId, parsed.data as Record<string, unknown>);
      res.json(org);
    } catch (error: any) {
      console.error("Error updating org setup:", error);
      res.status(400).json({ message: error.message || "Failed to update setup" });
    }
  });

  app.post("/api/org/setup/complete", ...setupScoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const org = await storage.completeOrgSetup(ctx.orgId);
      res.json(org);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to complete setup" });
    }
  });

  app.get("/api/imports/templates/:type", isAuthenticated, (req, res) => {
    const template = TEMPLATES[req.params.type];
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${template.filename}"`);
    res.send(template.content);
  });

  app.get("/api/imports/history", ...importScoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const history = await storage.getImportHistory(ctx.orgId);
      res.json(history);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch import history" });
    }
  });

  app.post("/api/products/import/preview", ...importScoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const { contentBase64, fileName, mapping, duplicateMode = "skip" } = req.body;
      if (!contentBase64 || !fileName) {
        return res.status(400).json({ message: "contentBase64 and fileName are required" });
      }
      const sheet = await parseSpreadsheet(contentBase64, fileName);
      const mapped = mapping ? applyColumnMapping(sheet.rows, mapping) : sheet.rows;
      const orgProducts = await db.select().from(products).where(eq(products.orgId, ctx.orgId));
      const bySku = new Map(orgProducts.map((p) => [p.productId, p]));
      const preview = previewProductImport(mapped, bySku, duplicateMode);
      res.json({ headers: sheet.headers, ...preview });
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Preview failed" });
    }
  });

  app.post("/api/products/import", ...importScoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const { rows, duplicateMode = "skip", confirmed, fileName } = req.body;
      if (!confirmed) {
        return res.status(400).json({ message: "Preview required. Set confirmed: true to import." });
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "rows array is required" });
      }
      const result = await storage.importProducts(rows, ctx.orgId, { duplicateMode, confirmed: true });
      const userId = req.user?.claims?.sub ?? req.user?.id;
      await storage.recordImportHistory({
        orgId: ctx.orgId,
        importType: "products",
        fileName: fileName ?? null,
        duplicateMode,
        importedCount: result.imported,
        skippedCount: result.skipped,
        failedCount: result.failed,
        failedRows: result.errors.length ? result.errors : null,
        createdBy: userId ?? null,
      });
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Import failed" });
    }
  });

  app.post("/api/customers/import/preview", ...importScoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const {
        contentBase64,
        fileName,
        mapping,
        duplicateMode = "skip",
        defaultCategory = "Bronze",
      } = req.body;
      if (!contentBase64 || !fileName) {
        return res.status(400).json({ message: "contentBase64 and fileName are required" });
      }
      const existing = await storage.getCustomers(ctx.orgId);
      const isVcard = /\.vcf$/i.test(fileName);

      if (isVcard) {
        const text = Buffer.from(contentBase64, "base64").toString("utf-8");
        const preview = previewVcardCustomerImport(
          text,
          existing,
          duplicateMode,
          defaultCategory,
        );
        return res.json({ headers: [], ...preview });
      }

      const sheet = await parseSpreadsheet(contentBase64, fileName);
      const mapped = mapping ? applyColumnMapping(sheet.rows, mapping) : sheet.rows;
      const preview = previewCustomerImport(mapped, existing, duplicateMode, defaultCategory);
      res.json({ headers: sheet.headers, ...preview });
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Preview failed" });
    }
  });

  app.post("/api/customers/import", ...importScoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const { rows, duplicateMode = "skip", confirmed, fileName } = req.body;
      if (!confirmed) {
        return res.status(400).json({ message: "Preview required. Set confirmed: true to import." });
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "rows array is required" });
      }
      const result = await storage.importCustomers(rows, ctx.orgId, { duplicateMode, confirmed: true });
      const userId = req.user?.claims?.sub ?? req.user?.id;
      await storage.recordImportHistory({
        orgId: ctx.orgId,
        importType: "customers",
        fileName: fileName ?? null,
        duplicateMode,
        importedCount: result.imported + result.merged,
        skippedCount: result.skipped,
        failedCount: result.failed,
        failedRows: result.errors.length ? result.errors : null,
        createdBy: userId ?? null,
      });
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Import failed" });
    }
  });

  app.get("/api/imports/failed/:historyId", ...importScoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const history = await storage.getImportHistory(ctx.orgId, 200);
      const entry = history.find((h) => h.id === req.params.historyId);
      if (!entry) return res.status(404).json({ message: "Import record not found" });
      const failed = entry.failedRows;
      if (!failed || !Array.isArray(failed)) {
        return res.status(404).json({ message: "No failed rows recorded" });
      }
      const lines = ["error", ...failed.map((e: string) => `"${e.replace(/"/g, '""')}"`)];
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="failed-${entry.importType}-${entry.id}.csv"`);
      res.send(lines.join("\n"));
    } catch (error) {
      res.status(500).json({ message: "Failed to export errors" });
    }
  });
}
