import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { db } from "../db";
import { customers, organizations } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { recordAdminAudit } from "../adminAudit";
import {
  renderReceiptTemplate,
  buildSampleReceiptContext,
  DEFAULT_RECEIPT_TEMPLATE,
} from "../templates/receipt.html";
import { verifyUnsubscribeToken } from "../services/receiptSigning";
import { APP_BASE_PATH } from "../appBase";
import { apiPathWithBase } from "@shared/appPaths";

const settingsBodySchema = z.object({
  receiptTemplateHtml: z.string().max(100_000).nullable().optional(),
});

export function registerReceiptRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/receipts/unsubscribe", async (req, res) => {
    try {
      const token = String(req.query.token ?? "");
      if (!token) {
        return res.status(400).send("Missing token");
      }
      const parsed = verifyUnsubscribeToken(token);
      if (!parsed) {
        return res.status(400).send("Invalid or expired unsubscribe link");
      }
      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, parsed.customerId))
        .limit(1);
      if (!customer) {
        return res.status(404).send("Customer not found");
      }
      await db
        .update(customers)
        .set({ receiptEmailOptIn: false, updatedAt: new Date() })
        .where(eq(customers.id, parsed.customerId));
      res
        .type("html")
        .send(
          "<!DOCTYPE html><html><body><h1>Unsubscribed</h1><p>You will no longer receive email receipts.</p></body></html>",
        );
    } catch (error) {
      console.error("[Receipts] unsubscribe error:", error);
      res.status(500).send("Failed to unsubscribe");
    }
  });

  app.get("/api/receipts/settings", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const org = await storage.getOrgProfile(ctx.orgId);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      res.json({
        receiptTemplateHtml: org.receiptTemplateHtml ?? "",
        defaultTemplate: DEFAULT_RECEIPT_TEMPLATE,
        resendConfigured: !!process.env.RESEND_API_KEY?.trim(),
        fromEmail:
          process.env.RECEIPT_FROM_EMAIL?.trim() ||
          process.env.RESEND_FROM_EMAIL?.trim() ||
          null,
      });
    } catch (error) {
      console.error("[Receipts] get settings:", error);
      res.status(500).json({ message: "Failed to fetch receipt settings" });
    }
  });

  app.put("/api/receipts/settings", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      const body = settingsBodySchema.parse(req.body ?? {});
      await storage.updateOrgProfile(ctx.orgId, {
        receiptTemplateHtml: body.receiptTemplateHtml ?? null,
      });
      await recordAdminAudit(req, {
        actorUserId: req.user?.id ?? "unknown",
        actorRole: ctx.role,
        orgId: ctx.orgId,
        action: "receipt.settings.updated",
        targetType: "organization",
        targetId: ctx.orgId,
      });
      res.json({ message: "Receipt settings updated" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid settings", errors: error.errors });
      }
      console.error("[Receipts] put settings:", error);
      res.status(500).json({ message: "Failed to update receipt settings" });
    }
  });

  app.get("/api/receipts/preview", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const template =
        typeof req.query.template === "string" ? req.query.template : undefined;
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, ctx.orgId))
        .limit(1);
      const base =
        process.env.VITE_APP_URL?.trim()?.replace(/\/$/, "") || "http://localhost:5000";
      const sampleUnsub = `${base}${apiPathWithBase(APP_BASE_PATH, "/api/receipts/unsubscribe?token=sample")}`;
      const sample = buildSampleReceiptContext(sampleUnsub);
      if (org) {
        sample.org.name = org.tradingName || org.name;
        sample.org.logoUrl = org.logoUrl || "";
        sample.footer = org.receiptFooter || sample.footer;
      }
      const html = renderReceiptTemplate(
        template ?? org?.receiptTemplateHtml ?? "",
        sample,
      );
      res.type("html").send(html);
    } catch (error) {
      console.error("[Receipts] preview:", error);
      res.status(500).json({ message: "Failed to render preview" });
    }
  });
}
