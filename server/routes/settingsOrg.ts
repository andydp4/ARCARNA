import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { isAuthenticated, isOwner, requireRole, requireOrgContext, requireOrgScope, requireSuperAdminMfa } from "../auth";
import { getAuthRuntimeSnapshot, getAuthProvider } from "../authRuntime";
import { canAssignRole, canManageUser, isRole } from "@shared/rbac";
import type { Role, Organization } from "@shared/schema";
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

/**
 * Shapes an `Organization` row into the payload `GET`/`PATCH /api/settings`
 * both return. Kept in one place so the two routes can never drift apart on
 * field names — client/src/pages/settings.tsx and client/src/pages/pos.tsx
 * (tax-at-checkout) and client/src/pages/orders.tsx (bank details / order
 * display) all read this same shape.
 *
 * A few fields here are still not backed by a real, per-org toggle:
 *  - `vatEnabled` is always `true` — there is no `organizations` column for
 *    it yet, so VAT can't actually be switched off per org. pos.tsx already
 *    guards for `=== false`, so always returning `true` is a safe no-op
 *    rather than a regression; the Settings UI doesn't offer to change it
 *    (see ARC-006 in the settings.tsx history for why).
 *  - `cardPaymentEnabled`/`cashPaymentEnabled`/`tickPaymentEnabled`/
 *    `transferPaymentEnabled` are always `true` for the same reason: nothing
 *    in the checkout flow reads a per-method toggle today.
 */
function mapOrgToSettings(org: Organization) {
  const taxRate = org.defaultTaxRate != null ? parseFloat(String(org.defaultTaxRate)) : 20;
  const commissionRate =
    org.defaultCashierCommissionRate != null ? parseFloat(String(org.defaultCashierCommissionRate)) : 10;
  return {
    businessName: org.tradingName || org.name,
    businessAddress: org.address || "",
    businessPhone: org.phone || "",
    businessEmail: org.email || "",
    vatEnabled: true,
    vatRate: Number.isFinite(taxRate) ? taxRate : 20,
    vatNumber: org.vatNumber || "",
    cardPaymentEnabled: true,
    cashPaymentEnabled: true,
    tickPaymentEnabled: true,
    transferPaymentEnabled: true,
    // Bank details shown on invoices/receipts and copied at the till for
    // transfer payments (client/src/pages/orders.tsx) — sourced from the
    // same `invoiceBank*` columns Settings → Invoice → Branding writes, so
    // there is exactly one place that actually saves them.
    bankName: org.invoiceBankName || "",
    accountNumber: org.invoiceBankAccountNumber || "",
    sortCode: org.invoiceBankSortCode || "",
    invoicePaymentLink: org.invoicePaymentLink || "",
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
    defaultCashierCommissionRate: Number.isFinite(commissionRate) ? commissionRate : 10,
    requireCashierForSale: org.requireCashierForSale ?? false,
    shiftInactivityCloseAfter: org.shiftInactivityCloseAfter || "never",
    globalExpenseAllocationMode: org.globalExpenseAllocationMode || "daily_percentage",
  };
}

/**
 * What `PATCH /api/settings` accepts from the Business Information and Tax
 * Settings cards (client/src/pages/settings.tsx). Deliberately a narrower
 * subset of `orgProfilePatchSchema` (shared/setup.ts) — this endpoint is
 * ADMIN/SUPER_ADMIN only and exists for exactly these two cards, not as a
 * second general-purpose org-profile writer alongside `PATCH /api/org/setup`.
 */
const settingsPatchSchema = z.object({
  businessName: z.string().trim().min(1).max(255).optional(),
  businessAddress: z.string().trim().max(1024).optional(),
  businessPhone: z.string().trim().max(50).optional(),
  businessEmail: z.union([z.literal(""), z.string().trim().max(255).email()]).optional(),
  vatNumber: z.string().trim().max(50).optional(),
  vatRate: z.number().min(0).max(100).optional(),
});

export function registerSettingsOrgRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/settings", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const org = await storage.getOrgProfile(ctx.orgId);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }
      res.json(mapOrgToSettings(org));
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  // Business Information and Tax Settings are the only cards on the Settings
  // page that write real org data of their own (everything else either
  // already has its own real save path — Branding, org name, cashier
  // commission, feature flags — or has no server-side concept behind it at
  // all). ADMIN/SUPER_ADMIN only, same bar as `PATCH /api/org/setup`'s other
  // org-identity fields.
  app.patch(
    "/api/settings",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN"),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        const parsed = settingsPatchSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid settings data", errors: parsed.error.errors });
        }
        const { businessName, businessAddress, businessPhone, businessEmail, vatNumber, vatRate } = parsed.data;
        const patch: Record<string, unknown> = {};
        if (businessName !== undefined) patch.tradingName = businessName;
        if (businessAddress !== undefined) patch.address = businessAddress;
        if (businessPhone !== undefined) patch.phone = businessPhone;
        if (businessEmail !== undefined) patch.email = businessEmail;
        if (vatNumber !== undefined) patch.vatNumber = vatNumber;
        if (vatRate !== undefined) patch.defaultTaxRate = String(vatRate);
        const org = await storage.updateOrgProfile(ctx.orgId, patch);
        res.json(mapOrgToSettings(org));
      } catch (error: any) {
        console.error("Error updating settings:", error);
        res.status(400).json({ message: error.message || "Failed to update settings" });
      }
    },
  );
}
