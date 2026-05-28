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

export function registerSettingsOrgRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/settings", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const org = await storage.getOrgProfile(ctx.orgId);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }
      const taxRate = org.defaultTaxRate != null ? parseFloat(String(org.defaultTaxRate)) : 20;
      res.json({
        businessName: org.tradingName || org.name,
        businessAddress: org.address || "",
        businessPhone: org.phone || "",
        businessEmail: org.email || "",
        businessWebsite: "",
        vatEnabled: true,
        vatRate: Number.isFinite(taxRate) ? taxRate : 20,
        vatNumber: org.vatNumber || "",
        cardPaymentEnabled: true,
        cashPaymentEnabled: true,
        tickPaymentEnabled: true,
        transferPaymentEnabled: true,
        lowStockThreshold: 20,
        criticalStockThreshold: 5,
        multiLocationEnabled: false,
        currency: org.currency || "GBP",
        timezone: org.timezone || "Europe/London",
        receiptFooter: org.receiptFooter || "",
      });
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.put("/api/settings", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const body = req.body ?? {};
      const org = await storage.updateOrgProfile(ctx.orgId, {
        tradingName: body.businessName,
        address: body.businessAddress,
        phone: body.businessPhone,
        email: body.businessEmail,
        vatNumber: body.vatNumber,
        defaultTaxRate: body.vatRate,
        receiptFooter: body.receiptFooter,
        currency: body.currency,
        timezone: body.timezone,
      });
      res.json({ message: "Settings updated successfully", orgId: org.id });
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

}
