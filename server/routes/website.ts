import type { Express, Request, RequestHandler } from "express";
import { z } from "zod";
import {
  createWebsiteService,
  WebsitePublicOrderError,
  type WebsiteOrderRuntime,
} from "../services/website";

type WebsiteService = ReturnType<typeof createWebsiteService>;

const uuidSchema = z.string().uuid();
let defaultWebsiteService: WebsiteService | null = null;
let defaultWebsiteOrderRuntime: WebsiteOrderRuntime | null = null;
const adminAuditModulePath = "../adminAudit";
const websiteRepositoryModulePath = "../services/websiteRepository";
const appsDbModulePath = "../../apps/server/src/db";
const engineWiringModulePath = "../../apps/server/src/engine.wiring";
const eventBusModulePath = "../eventBus";
const appsDbSchemaModulePath = "../../apps/server/src/db/schema";
const drizzleOrmModulePath = "drizzle-orm";

async function getDefaultWebsiteService(): Promise<WebsiteService> {
  if (defaultWebsiteService) return defaultWebsiteService;
  const { websiteRepository } = await import(websiteRepositoryModulePath);
  defaultWebsiteService = createWebsiteService(websiteRepository);
  return defaultWebsiteService;
}

async function getDefaultWebsiteOrderRuntime(): Promise<WebsiteOrderRuntime> {
  if (defaultWebsiteOrderRuntime) return defaultWebsiteOrderRuntime;
  const [{ withTransaction }, { engine }, { publishEventTx }] = await Promise.all([
    import(appsDbModulePath),
    import(engineWiringModulePath),
    import(eventBusModulePath),
  ]);
  defaultWebsiteOrderRuntime = {
    withTransaction,
    engine,
    publishOrderCreated: (tx, eventType, correlationId, payload, options) =>
      publishEventTx(tx as never, eventType, correlationId, payload, options),
    async loadCreatedOrder(tx, orderId) {
      const [{ orders, order_items }, { eq }] = await Promise.all([
        import(appsDbSchemaModulePath),
        import(drizzleOrmModulePath),
      ]);
      const db = tx as {
        select: () => {
          from: (table: unknown) => {
            where: (where: unknown) => Promise<Array<Record<string, unknown>>>;
          };
        };
      };
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId));
      if (!order) return null;
      const items = await db
        .select()
        .from(order_items)
        .where(eq(order_items.order_id, orderId));
      return {
        id: String(order.id),
        status: order.status === null || order.status === undefined ? null : String(order.status),
        total: order.total as string | number | null,
        paymentMethod:
          order.payment_method === null || order.payment_method === undefined
            ? null
            : String(order.payment_method),
        customerId:
          order.customer_id === null || order.customer_id === undefined
            ? null
            : String(order.customer_id),
        items: items.map((orderLine) => ({
          id: String(orderLine.id),
          productId:
            orderLine.product_id === null || orderLine.product_id === undefined
              ? null
              : String(orderLine.product_id),
          quantity: Number(orderLine.quantity ?? 0),
          unitPrice: orderLine.unit_price as string | number | null,
          totalPrice: orderLine.total_price as string | number | null,
        })),
      };
    },
  };
  return defaultWebsiteOrderRuntime;
}

function zodErrorPayload(error: z.ZodError) {
  return { message: "Invalid website payload", errors: error.errors };
}

async function recordWebsiteAdminAudit(
  req: Request,
  params: {
    actorUserId: string;
    actorRole: string;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    orgId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  const { recordAdminAudit } = await import(adminAuditModulePath);
  await recordAdminAudit(req, params);
}

function resolvePublicOrgId(req: Request): string | null {
  const envOrgId =
    process.env.WM_SUPPLIES_ORG_ID?.trim() ||
    process.env.WM_SUPPLIES_WEBSITE_ORG_ID?.trim() ||
    "";
  if (envOrgId && uuidSchema.safeParse(envOrgId).success) return envOrgId;

  const raw = String(req.query.orgId ?? req.query.org ?? "").trim();
  if (raw && uuidSchema.safeParse(raw).success) return raw;
  return null;
}

function getAdminContext(req: Request) {
  const ctx = (req as Request & { orgContext?: { orgId?: string; role?: string } })
    .orgContext;
  if (!ctx?.orgId) {
    return null;
  }
  return {
    orgId: ctx.orgId,
    role: ctx.role ?? "CASHIER",
    userId:
      (req as Request & { user?: { id?: string; role?: string } }).user?.id ??
      "unknown",
  };
}

function getBlockId(req: Request, res: Parameters<RequestHandler>[1]): string | null {
  const parsed = uuidSchema.safeParse(req.params.blockId);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid website block id" });
    return null;
  }
  return parsed.data;
}

export function requireWebsiteStaffRole(): RequestHandler {
  const allowed = ["SUPER_ADMIN", "ADMIN", "MANAGER"];
  return (req, res, next) => {
    const user = (req as Request & { user?: { role?: string; isOwner?: boolean } }).user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const role = user.role ?? (user.isOwner ? "SUPER_ADMIN" : "CASHIER");
    if (!allowed.includes(role)) {
      return res.status(403).json({
        message: `Access denied. Requires role: ${allowed.join(" or ")}`,
      });
    }
    return next();
  };
}

export function createWebsitePublicHandlers(
  service?: WebsiteService,
  orderRuntime?: WebsiteOrderRuntime,
) {
  const getSiteConfig: RequestHandler = async (req, res) => {
    try {
      const activeService = service ?? (await getDefaultWebsiteService());
      const orgId = resolvePublicOrgId(req);
      if (!orgId) {
        return res.status(400).json({
          message: "WM Supplies website organization is not configured",
        });
      }
      const page = String(req.query.page ?? "home").trim() || "home";
      res.json(await activeService.getPublicSiteConfig(orgId, page));
    } catch (error) {
      console.error("[Website] public site config:", error);
      res.status(500).json({ message: "Failed to load website config" });
    }
  };

  const getProducts: RequestHandler = async (req, res) => {
    try {
      const activeService = service ?? (await getDefaultWebsiteService());
      const orgId = resolvePublicOrgId(req);
      if (!orgId) {
        return res.status(400).json({
          message: "WM Supplies website organization is not configured",
        });
      }
      res.json(await activeService.listPublicProducts(orgId));
    } catch (error) {
      console.error("[Website] public products:", error);
      res.status(500).json({ message: "Failed to load website products" });
    }
  };

  const createOrder: RequestHandler = async (req, res) => {
    try {
      const activeService = service ?? (await getDefaultWebsiteService());
      const orgId = resolvePublicOrgId(req);
      if (!orgId) {
        return res.status(400).json({
          message: "WM Supplies website organization is not configured",
        });
      }
      const runtime = orderRuntime ?? (await getDefaultWebsiteOrderRuntime());
      const result = await activeService.submitPublicOrder(orgId, req.body ?? {}, runtime);
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(zodErrorPayload(error));
      }
      if (error instanceof WebsitePublicOrderError) {
        return res.status(error.statusCode).json({
          message: error.message,
          details: error.details,
        });
      }
      console.error("[Website] public order:", error);
      res.status(500).json({ message: "Failed to create website order" });
    }
  };

  return { getSiteConfig, getProducts, createOrder };
}

export function registerWebsitePublicRoutes(
  app: Express,
  service?: WebsiteService,
  orderRuntime?: WebsiteOrderRuntime,
): void {
  const { getSiteConfig, getProducts, createOrder } = createWebsitePublicHandlers(
    service,
    orderRuntime,
  );
  app.get("/api/public/wm-supplies/site-config", getSiteConfig);
  app.get("/api/public/wm-supplies/products", getProducts);
  app.get("/api/public/products", getProducts);
  app.post("/api/public/wm-supplies/orders", createOrder);
}

export function createWebsiteAdminHandlers(service?: WebsiteService) {
  const getConfig: RequestHandler = async (req, res) => {
    try {
      const activeService = service ?? (await getDefaultWebsiteService());
      const ctx = getAdminContext(req);
      if (!ctx) return res.status(400).json({ message: "Organization context required" });
      const page = String(req.query.page ?? "home").trim() || "home";
      res.json(await activeService.getSiteConfig(ctx.orgId, page, { includeHiddenBlocks: true }));
    } catch (error) {
      console.error("[Website] admin config:", error);
      res.status(500).json({ message: "Failed to load website config" });
    }
  };

  const updateTheme: RequestHandler = async (req, res) => {
    try {
      const activeService = service ?? (await getDefaultWebsiteService());
      const ctx = getAdminContext(req);
      if (!ctx) return res.status(400).json({ message: "Organization context required" });
      const theme = await activeService.updateTheme(ctx.orgId, req.body ?? {}, ctx.userId);
      await recordWebsiteAdminAudit(req, {
        actorUserId: ctx.userId,
        actorRole: ctx.role,
        orgId: ctx.orgId,
        action: "website.theme.updated",
        targetType: "website_theme_settings",
        targetId: ctx.orgId,
      });
      res.json(theme);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(zodErrorPayload(error));
      }
      console.error("[Website] update theme:", error);
      res.status(500).json({ message: "Failed to update website theme" });
    }
  };

  const updateOrderSettings: RequestHandler = async (req, res) => {
    try {
      const activeService = service ?? (await getDefaultWebsiteService());
      const ctx = getAdminContext(req);
      if (!ctx) return res.status(400).json({ message: "Organization context required" });
      const settings = await activeService.updateOrderSettings(
        ctx.orgId,
        req.body ?? {},
        ctx.userId,
      );
      await recordWebsiteAdminAudit(req, {
        actorUserId: ctx.userId,
        actorRole: ctx.role,
        orgId: ctx.orgId,
        action: "website.order_settings.updated",
        targetType: "website_order_settings",
        targetId: ctx.orgId,
      });
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(zodErrorPayload(error));
      }
      console.error("[Website] update order settings:", error);
      res.status(500).json({ message: "Failed to update website order settings" });
    }
  };

  const createBlock: RequestHandler = async (req, res) => {
    try {
      const activeService = service ?? (await getDefaultWebsiteService());
      const ctx = getAdminContext(req);
      if (!ctx) return res.status(400).json({ message: "Organization context required" });
      const block = await activeService.upsertBlock(ctx.orgId, req.body ?? {}, ctx.userId);
      await recordWebsiteAdminAudit(req, {
        actorUserId: ctx.userId,
        actorRole: ctx.role,
        orgId: ctx.orgId,
        action: "website.block.created",
        targetType: "website_blocks",
        targetId: block.id,
      });
      res.status(201).json(block);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(zodErrorPayload(error));
      }
      console.error("[Website] create block:", error);
      res.status(500).json({ message: "Failed to create website block" });
    }
  };

  const updateBlock: RequestHandler = async (req, res) => {
    try {
      const activeService = service ?? (await getDefaultWebsiteService());
      const ctx = getAdminContext(req);
      if (!ctx) return res.status(400).json({ message: "Organization context required" });
      const blockId = getBlockId(req, res);
      if (!blockId) return;
      const block = await activeService.updateBlock(ctx.orgId, blockId, req.body ?? {}, ctx.userId);
      if (!block) return res.status(404).json({ message: "Website block not found" });
      await recordWebsiteAdminAudit(req, {
        actorUserId: ctx.userId,
        actorRole: ctx.role,
        orgId: ctx.orgId,
        action: "website.block.updated",
        targetType: "website_blocks",
        targetId: block.id,
      });
      res.json(block);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(zodErrorPayload(error));
      }
      console.error("[Website] update block:", error);
      res.status(500).json({ message: "Failed to update website block" });
    }
  };

  const duplicateBlock: RequestHandler = async (req, res) => {
    try {
      const activeService = service ?? (await getDefaultWebsiteService());
      const ctx = getAdminContext(req);
      if (!ctx) return res.status(400).json({ message: "Organization context required" });
      const blockId = getBlockId(req, res);
      if (!blockId) return;
      const block = await activeService.duplicateBlock(ctx.orgId, blockId, ctx.userId);
      if (!block) return res.status(404).json({ message: "Website block not found" });
      await recordWebsiteAdminAudit(req, {
        actorUserId: ctx.userId,
        actorRole: ctx.role,
        orgId: ctx.orgId,
        action: "website.block.duplicated",
        targetType: "website_blocks",
        targetId: block.id,
        metadata: { sourceBlockId: blockId },
      });
      res.status(201).json(block);
    } catch (error) {
      console.error("[Website] duplicate block:", error);
      res.status(500).json({ message: "Failed to duplicate website block" });
    }
  };

  const deleteBlock: RequestHandler = async (req, res) => {
    try {
      const activeService = service ?? (await getDefaultWebsiteService());
      const ctx = getAdminContext(req);
      if (!ctx) return res.status(400).json({ message: "Organization context required" });
      const blockId = getBlockId(req, res);
      if (!blockId) return;
      const deleted = await activeService.deleteBlock(ctx.orgId, blockId);
      if (!deleted) return res.status(404).json({ message: "Website block not found" });
      await recordWebsiteAdminAudit(req, {
        actorUserId: ctx.userId,
        actorRole: ctx.role,
        orgId: ctx.orgId,
        action: "website.block.deleted",
        targetType: "website_blocks",
        targetId: blockId,
      });
      res.json({ deleted: true });
    } catch (error) {
      console.error("[Website] delete block:", error);
      res.status(500).json({ message: "Failed to delete website block" });
    }
  };

  const listUploads: RequestHandler = async (req, res) => {
    try {
      const activeService = service ?? (await getDefaultWebsiteService());
      const ctx = getAdminContext(req);
      if (!ctx) return res.status(400).json({ message: "Organization context required" });
      res.json(await activeService.listUploads(ctx.orgId));
    } catch (error) {
      console.error("[Website] list uploads:", error);
      res.status(500).json({ message: "Failed to load website uploads" });
    }
  };

  const createUploadMetadata: RequestHandler = async (req, res) => {
    try {
      const activeService = service ?? (await getDefaultWebsiteService());
      const ctx = getAdminContext(req);
      if (!ctx) return res.status(400).json({ message: "Organization context required" });
      const upload = await activeService.createUpload(ctx.orgId, req.body ?? {}, ctx.userId);
      await recordWebsiteAdminAudit(req, {
        actorUserId: ctx.userId,
        actorRole: ctx.role,
        orgId: ctx.orgId,
        action: "website.upload.created",
        targetType: "website_uploaded_files",
        targetId: upload.id,
      });
      res.status(201).json(upload);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(zodErrorPayload(error));
      }
      console.error("[Website] create upload metadata:", error);
      res.status(500).json({ message: "Failed to create website upload" });
    }
  };

  return {
    getConfig,
    updateTheme,
    updateOrderSettings,
    createBlock,
    updateBlock,
    duplicateBlock,
    deleteBlock,
    listUploads,
    createUploadMetadata,
  };
}

export function registerWebsiteAdminRoutes(
  app: Express,
  scoped: RequestHandler[],
  service?: WebsiteService,
): void {
  const staffOnly = [...scoped, requireWebsiteStaffRole()];
  const {
    getConfig,
    updateTheme,
    updateOrderSettings,
    createBlock,
    updateBlock,
    duplicateBlock,
    deleteBlock,
    listUploads,
    createUploadMetadata,
  } = createWebsiteAdminHandlers(service);

  app.get("/api/website/config", ...staffOnly, getConfig);
  app.put("/api/website/theme", ...staffOnly, updateTheme);
  app.put("/api/website/order-settings", ...staffOnly, updateOrderSettings);
  app.post("/api/website/blocks", ...staffOnly, createBlock);
  app.put("/api/website/blocks/:blockId", ...staffOnly, updateBlock);
  app.post("/api/website/blocks/:blockId/duplicate", ...staffOnly, duplicateBlock);
  app.delete("/api/website/blocks/:blockId", ...staffOnly, deleteBlock);
  app.get("/api/website/uploads", ...staffOnly, listUploads);
  app.post("/api/website/uploads/metadata", ...staffOnly, createUploadMetadata);
}
