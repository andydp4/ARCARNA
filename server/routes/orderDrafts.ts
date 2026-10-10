import type { Express, RequestHandler } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireRole } from "../auth";
import { rolesAtLeast } from "@shared/accessPolicy";
import { orderDraftPayloadSchema } from "@shared/orders/orderDraft";
import { orderDrafts } from "@shared/schema";
import { db } from "../db";

const staff = requireRole(...rolesAtLeast("CASHIER"));

function owner(req: any): { orgId: string; userId: string } | null {
  const orgId = req.orgContext?.orgId as string | undefined;
  const userId = req.user?.id as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, userId };
}

export function registerOrderDraftRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/order-drafts", ...scoped, staff, async (req: any, res) => {
    const who = owner(req);
    if (!who) return res.status(400).json({ message: "Org context required" });
    const rows = await db
      .select({
        id: orderDrafts.id,
        revision: orderDrafts.revision,
        label: orderDrafts.label,
        updatedAt: orderDrafts.updatedAt,
      })
      .from(orderDrafts)
      .where(and(eq(orderDrafts.orgId, who.orgId), eq(orderDrafts.userId, who.userId), eq(orderDrafts.status, "open")))
      .orderBy(desc(orderDrafts.updatedAt))
      .limit(30);
    res.setHeader("Cache-Control", "no-store");
    res.json({ drafts: rows });
  });

  app.get("/api/order-drafts/:id", ...scoped, staff, async (req: any, res) => {
    const who = owner(req);
    if (!who) return res.status(400).json({ message: "Org context required" });
    const [row] = await db
      .select()
      .from(orderDrafts)
      .where(and(eq(orderDrafts.id, req.params.id), eq(orderDrafts.orgId, who.orgId), eq(orderDrafts.userId, who.userId)))
      .limit(1);
    if (!row || row.status !== "open") return res.status(404).json({ message: "Draft not found" });
    res.setHeader("Cache-Control", "no-store");
    res.json({ id: row.id, revision: row.revision, label: row.label, payload: row.payload, updatedAt: row.updatedAt });
  });

  app.post("/api/order-drafts", ...scoped, staff, async (req: any, res) => {
    const who = owner(req);
    if (!who) return res.status(400).json({ message: "Org context required" });
    const parsed = orderDraftPayloadSchema.safeParse(req.body?.payload);
    if (!parsed.success) return res.status(400).json({ message: "This draft could not be saved." });
    const [row] = await db
      .insert(orderDrafts)
      .values({
        orgId: who.orgId,
        userId: who.userId,
        revision: 1,
        status: "open",
        label: parsed.data.label || "Draft",
        payload: parsed.data,
      })
      .returning({ id: orderDrafts.id, revision: orderDrafts.revision });
    res.status(201).json(row);
  });

  app.put("/api/order-drafts/:id", ...scoped, staff, async (req: any, res) => {
    const who = owner(req);
    if (!who) return res.status(400).json({ message: "Org context required" });
    const body = z.object({ revision: z.number().int().positive(), payload: orderDraftPayloadSchema }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "This draft could not be saved." });
    const [current] = await db
      .select()
      .from(orderDrafts)
      .where(and(eq(orderDrafts.id, req.params.id), eq(orderDrafts.orgId, who.orgId), eq(orderDrafts.userId, who.userId)))
      .limit(1);
    if (!current || current.status !== "open") return res.status(404).json({ message: "Draft not found" });
    if (current.revision !== body.data.revision) {
      return res.status(409).json({
        message: "This draft was changed on another till.",
        revision: current.revision,
        payload: current.payload,
      });
    }
    const [saved] = await db
      .update(orderDrafts)
      .set({
        revision: current.revision + 1,
        label: body.data.payload.label || "Draft",
        payload: body.data.payload,
        updatedAt: new Date(),
      })
      .where(and(eq(orderDrafts.id, current.id), eq(orderDrafts.revision, current.revision)))
      .returning({ id: orderDrafts.id, revision: orderDrafts.revision });
    if (!saved) {
      return res.status(409).json({ message: "This draft was changed on another till." });
    }
    res.json(saved);
  });

  app.post("/api/order-drafts/:id/close", ...scoped, staff, async (req: any, res) => {
    const who = owner(req);
    if (!who) return res.status(400).json({ message: "Org context required" });
    const body = z.object({ outcome: z.enum(["submitted", "discarded"]) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Say whether the draft was used or discarded." });
    const [saved] = await db
      .update(orderDrafts)
      .set({ status: body.data.outcome, updatedAt: new Date() })
      .where(
        and(
          eq(orderDrafts.id, req.params.id),
          eq(orderDrafts.orgId, who.orgId),
          eq(orderDrafts.userId, who.userId),
          eq(orderDrafts.status, "open"),
        ),
      )
      .returning({ id: orderDrafts.id });
    if (!saved) return res.status(404).json({ message: "Draft not found" });
    res.json({ id: saved.id, status: body.data.outcome });
  });
}
