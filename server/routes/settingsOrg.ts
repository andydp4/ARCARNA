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
        logoUrl: org.logoUrl || "",
        receiptLogoEnabled: org.receiptLogoEnabled ?? false,
        invoiceLogoEnabled: org.invoiceLogoEnabled ?? false,
        accentStyle: org.accentStyle || "arcarna",
        businessColors: org.businessColors || null,
        invoicePrefix: org.invoicePrefix || "INV",
        invoiceStartNumber: org.invoiceStartNumber ?? 1000,
        paymentTerms: org.paymentTerms || "Net 30",
        cashierCommissionEnabled: org.cashierCommissionEnabled ?? false,
        defaultCashierCommissionRate: org.defaultCashierCommissionRate != null ? parseFloat(String(org.defaultCashierCommissionRate)) : 10,
        requireCashierForSale: org.requireCashierForSale ?? false,
        shiftInactivityCloseAfter: org.shiftInactivityCloseAfter || "never",
        globalExpenseAllocationMode: org.globalExpenseAllocationMode || "daily_percentage",
      });
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

}
