import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { db } from "../db";
import { savedViews } from "@shared/schema";
import { and, eq } from "drizzle-orm";

const PAGE_IDS = ["customers", "products", "orders"] as const;
type PageId = (typeof PAGE_IDS)[number];

const viewBodySchema = z.object({
  page: z.enum(PAGE_IDS),
  name: z.string().min(1).max(120),
  filters: z.record(z.unknown()).default({}),
  sort: z
    .object({
      column: z.string().optional(),
      direction: z.enum(["asc", "desc"]).optional(),
    })
    .default({}),
  isDefault: z.boolean().optional(),
});

function pageFilter(page: string): page is PageId {
  return (PAGE_IDS as readonly string[]).includes(page);
}

async function clearDefault(userId: string, orgId: string, page: PageId, exceptId?: string) {
  const rows = await db
    .select({ id: savedViews.id })
    .from(savedViews)
    .where(and(eq(savedViews.userId, userId), eq(savedViews.orgId, orgId), eq(savedViews.page, page), eq(savedViews.isDefault, true)));

  for (const row of rows) {
    if (exceptId && row.id === exceptId) continue;
    await db.update(savedViews).set({ isDefault: false }).where(eq(savedViews.id, row.id));
  }
}

export function registerSavedViewRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/saved-views", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const page = String(req.query.page || "");
      if (!pageFilter(page)) return res.status(400).json({ message: "Invalid page" });

      const rows = await db
        .select()
        .from(savedViews)
        .where(and(eq(savedViews.userId, userId), eq(savedViews.orgId, ctx.orgId), eq(savedViews.page, page)))
        .orderBy(savedViews.createdAt);

      res.json({ views: rows });
    } catch (e) {
      console.error("[SavedViews] list:", e);
      res.status(500).json({ message: "Failed to list saved views" });
    }
  });

  app.post("/api/saved-views", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const body = viewBodySchema.parse(req.body);
      if (body.isDefault) await clearDefault(userId, ctx.orgId, body.page);

      const [row] = await db
        .insert(savedViews)
        .values({
          userId,
          orgId: ctx.orgId,
          page: body.page,
          name: body.name,
          filters: body.filters,
          sort: body.sort,
          isDefault: body.isDefault ?? false,
        })
        .returning();

      res.status(201).json(row);
    } catch (e: any) {
      if (e.name === "ZodError") return res.status(400).json({ message: "Invalid data", errors: e.errors });
      console.error("[SavedViews] create:", e);
      res.status(500).json({ message: "Failed to save view" });
    }
  });

  app.patch("/api/saved-views/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const partial = viewBodySchema.partial().parse(req.body);
      const [existing] = await db
        .select()
        .from(savedViews)
        .where(and(eq(savedViews.id, req.params.id), eq(savedViews.userId, userId), eq(savedViews.orgId, ctx.orgId)))
        .limit(1);

      if (!existing) return res.status(404).json({ message: "View not found" });

      if (partial.isDefault) await clearDefault(userId, ctx.orgId, existing.page as PageId, existing.id);

      const [updated] = await db
        .update(savedViews)
        .set({
          ...(partial.name !== undefined ? { name: partial.name } : {}),
          ...(partial.filters !== undefined ? { filters: partial.filters } : {}),
          ...(partial.sort !== undefined ? { sort: partial.sort } : {}),
          ...(partial.isDefault !== undefined ? { isDefault: partial.isDefault } : {}),
        })
        .where(eq(savedViews.id, existing.id))
        .returning();

      res.json(updated);
    } catch (e: any) {
      if (e.name === "ZodError") return res.status(400).json({ message: "Invalid data", errors: e.errors });
      console.error("[SavedViews] update:", e);
      res.status(500).json({ message: "Failed to update view" });
    }
  });

  app.delete("/api/saved-views/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const [deleted] = await db
        .delete(savedViews)
        .where(and(eq(savedViews.id, req.params.id), eq(savedViews.userId, userId), eq(savedViews.orgId, ctx.orgId)))
        .returning({ id: savedViews.id });

      if (!deleted) return res.status(404).json({ message: "View not found" });
      res.json({ success: true });
    } catch (e) {
      console.error("[SavedViews] delete:", e);
      res.status(500).json({ message: "Failed to delete view" });
    }
  });
}
