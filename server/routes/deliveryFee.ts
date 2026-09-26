import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireRole } from "../auth";
import { rolesAtLeast, DELIVERY_FEE_SETTINGS_MIN_ROLE } from "@shared/accessPolicy";
import { organizations } from "@shared/schema";
import {
  DELIVERY_FEE_MAX,
  DELIVERY_FEE_NAME_MAX,
  deliveryFeeSettingsFrom,
} from "@shared/orders/deliveryFee";
import { recordAdminAudit } from "../adminAudit";

/**
 * The delivery fee's settings (v1.2.1): its name, the price one tap adds at
 * the till, and whether it counts in commission and margin (off by default).
 * Admins only; every change is logged with what it was and what it became.
 * Every role reads the three values through GET /api/settings: the till needs
 * the name and price.
 */
const patchSchema = z
  .object({
    name: z.string().trim().min(1, "Give the fee a name.").max(DELIVERY_FEE_NAME_MAX).optional(),
    defaultPrice: z
      .number({ invalid_type_error: "The price must be a number." })
      .min(0, "The price cannot be below £0.00.")
      .max(DELIVERY_FEE_MAX, `The price cannot be more than £${DELIVERY_FEE_MAX.toFixed(2)}.`)
      .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "The price must be in pounds and pence.")
      .optional(),
    commissionable: z.boolean().optional(),
  })
  .strict();

export function registerDeliveryFeeRoutes(app: Express, scoped: RequestHandler[]): void {
  app.put(
    "/api/settings/delivery-fee",
    ...scoped,
    requireRole(...rolesAtLeast(DELIVERY_FEE_SETTINGS_MIN_ROLE)),
    async (req: any, res) => {
      const parsed = patchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Check the delivery fee." });
      }
      try {
        const orgId = req.orgContext.orgId as string;
        const { db } = await import("../db");
        const [row] = await db
          .select({
            deliveryFeeName: organizations.deliveryFeeName,
            deliveryFeePrice: organizations.deliveryFeePrice,
            deliveryFeeCommissionable: organizations.deliveryFeeCommissionable,
          })
          .from(organizations)
          .where(eq(organizations.id, orgId));
        if (!row) return res.status(404).json({ message: "Organization not found" });
        const before = deliveryFeeSettingsFrom(row);
        const after = {
          name: parsed.data.name ?? before.name,
          defaultPrice: parsed.data.defaultPrice ?? before.defaultPrice,
          commissionable: parsed.data.commissionable ?? before.commissionable,
        };
        await db
          .update(organizations)
          .set({
            deliveryFeeName: after.name,
            deliveryFeePrice: after.defaultPrice.toFixed(2),
            deliveryFeeCommissionable: after.commissionable,
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, orgId));
        const changed = (Object.keys(after) as Array<keyof typeof after>).filter((k) => after[k] !== before[k]);
        if (changed.length > 0) {
          await recordAdminAudit(req, {
            actorUserId: req.user?.id ?? "unknown",
            actorRole: req.orgContext?.role ?? req.user?.role ?? "ADMIN",
            action: "delivery_fee.updated",
            targetType: "organization",
            targetId: orgId,
            orgId,
            metadata: Object.fromEntries(changed.map((k) => [k, { from: before[k], to: after[k] }])),
          });
        }
        res.json({
          deliveryFeeName: after.name,
          deliveryFeePrice: after.defaultPrice,
          deliveryFeeCommissionable: after.commissionable,
        });
      } catch (error) {
        console.error("[DeliveryFee] settings:", error);
        res.status(500).json({ message: "Failed to save the delivery fee" });
      }
    },
  );
}
