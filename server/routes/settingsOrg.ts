import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { isAuthenticated, isOwner, requireRole, requireOrgContext, requireOrgScope, requireSuperAdminMfa } from "../auth";
import { getAuthRuntimeSnapshot, getAuthProvider } from "../authRuntime";
import { canAssignRole, canManageUser, isRole } from "@shared/rbac";
import type { Role, Organization } from "@shared/schema";
import { recordAdminAudit } from "../adminAudit";
import { orgSettingsForRole } from "@shared/staffPolicy";
import { shopPrivacyFromOrg, shopPrivacyPatchSchema } from "@shared/shopPrivacy";
import { deliveryFeeSettingsFrom } from "@shared/orders/deliveryFee";
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
    // Operations Centre timing policy (migration 065). Projected HERE, not
    // only on /api/org/setup, because that route is MANAGER+ and the board
    // is a cashier's screen: the people whose cards these minutes colour
    // must be able to read them. Written from the Settings card; the four
    // "on time" minutes are admin only (Q16, shared/staffPolicy.ts).
    opsPrepSlaMinutes: org.opsPrepSlaMinutes ?? 20,
    opsDueSoonLeadMinutes: org.opsDueSoonLeadMinutes ?? 10,
    opsLateGraceMinutes: org.opsLateGraceMinutes ?? 5,
    opsDeliveryLeadMinutes: org.opsDeliveryLeadMinutes ?? 45,
    opsAutoClaimOnCreate: org.opsAutoClaimOnCreate ?? true,
    opsReconcilePollSeconds: org.opsReconcilePollSeconds ?? 60,
    opsAlertOnSlaDue: org.opsAlertOnSlaDue ?? false,
    opsKeepScreenAwake: org.opsKeepScreenAwake ?? true,
    // Price guard at the till (v1.2 Phase 4). Every role reads it: the till
    // is a cashier's screen. Only admins change it (PUT /api/settings/price-guard).
    priceGuardEnabled: org.priceGuardEnabled ?? false,
    // When below-minimum Signals go out (admin set, PUT /api/settings/review-rules).
    priceGuardMinSignal: org.priceGuardMinSignal ?? "immediate",
    // The delivery fee (v1.2.1). Every role reads it: the till adds the fee.
    // Only admins change it (PUT /api/settings/delivery-fee).
    ...(() => {
      const fee = deliveryFeeSettingsFrom(org);
      return {
        deliveryFeeName: fee.name,
        deliveryFeePrice: fee.defaultPrice,
        deliveryFeeCommissionable: fee.commissionable,
      };
    })(),
    // The shop's customer privacy notice + complaints contact (PRV-15). Public
    // by nature (shown to shop customers), so every staff role may read it.
    ...shopPrivacyFromOrg(org),
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
}).merge(shopPrivacyPatchSchema);

const PRIVACY_KEYS = [
  "privacyNoticeUrl",
  "privacyNoticeText",
  "complaintsContactName",
  "complaintsContactEmail",
] as const;

export function registerSettingsOrgRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/settings", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const org = await storage.getOrgProfile(ctx.orgId);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }
      // Every role reads this (the board needs its timings); the commission
      // rate is admin only (Q16).
      res.json(orgSettingsForRole(mapOrgToSettings(org), req.orgContext?.role ?? req.user?.role));
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
        const privacyChanged: string[] = [];
        for (const key of PRIVACY_KEYS) {
          const value = parsed.data[key];
          if (value === undefined) continue;
          // Blank clears the field (and hides its link), rather than storing "".
          patch[key] = value === "" ? null : value;
          privacyChanged.push(key);
        }
        const org = await storage.updateOrgProfile(ctx.orgId, patch);
        if (privacyChanged.length > 0) {
          // What customers are told about their data is a legal statement: keep a trail.
          await recordAdminAudit(req, {
            actorUserId: req.user?.id ?? "unknown",
            actorRole: req.orgContext?.role ?? "ADMIN",
            action: "shop_privacy.updated",
            targetType: "organization",
            targetId: ctx.orgId,
            orgId: ctx.orgId,
            metadata: { fields: privacyChanged },
          });
        }
        res.json(mapOrgToSettings(org));
      } catch (error: any) {
        console.error("Error updating settings:", error);
        res.status(400).json({ message: error.message || "Failed to update settings" });
      }
    },
  );
}
