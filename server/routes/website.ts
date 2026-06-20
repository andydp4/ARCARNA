import type { Express, Request, RequestHandler } from "express";
import { z } from "zod";
import { createWebsiteService } from "../services/website";

type WebsiteService = ReturnType<typeof createWebsiteService>;

const uuidSchema = z.string().uuid();
let defaultWebsiteService: WebsiteService | null = null;
const adminAuditModulePath = "../adminAudit";

async function getDefaultWebsiteService(): Promise<WebsiteService> {
  if (defaultWebsiteService) return defaultWebsiteService;
  const { websiteRepository } = await import("../services/websiteRepository");
  defaultWebsiteService = createWebsiteService(websiteRepository);
  return defaultWebsiteService;
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

export function createWebsitePublicHandlers(service?: WebsiteService) {
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

  return { getSiteConfig, getProducts };
}

export function registerWebsitePublicRoutes(
  app: Express,
  service?: WebsiteService,
): void {
  const { getSiteConfig, getProducts } = createWebsitePublicHandlers(service);
  app.get("/api/public/wm-supplies/site-config", getSiteConfig);
  app.get("/api/public/wm-supplies/products", getProducts);
  app.get("/api/public/products", getProducts);
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

  return { getConfig, updateTheme, updateOrderSettings, createBlock, createUploadMetadata };
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
    createUploadMetadata,
  } = createWebsiteAdminHandlers(service);

  app.get("/api/website/config", ...staffOnly, getConfig);
  app.put("/api/website/theme", ...staffOnly, updateTheme);
  app.put("/api/website/order-settings", ...staffOnly, updateOrderSettings);
  app.post("/api/website/blocks", ...staffOnly, createBlock);
  app.post("/api/website/uploads/metadata", ...staffOnly, createUploadMetadata);
}
