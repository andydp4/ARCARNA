import type { RequestHandler, Request, Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { shifts } from "../../shared/schema";
import { storage } from "../storage";
import { isDevAuthBypassEnabled } from "../authRuntime";

export async function tryPhase2dTestAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<boolean> {
  const testUserId = (req.headers["x-test-replit-user-id"] as string) || null;
  const isTestMode = process.env.PHASE2D_TEST === "1" && process.env.NODE_ENV !== "production";
  const clientIp = req.ip || (req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress || "";
  const isLocalhost =
    clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "::ffff:127.0.0.1";
  const testSecret = process.env.PHASE2D_TEST_SECRET;
  const secretMatch = !!testSecret && req.headers["x-test-secret"] === testSecret;
  const allowImpersonation = isTestMode && testUserId && isLocalhost && secretMatch;
  if (!allowImpersonation) return false;
  try {
    const roleAndOrg = await storage.getUserRoleAndOrg(testUserId);
    if (!roleAndOrg) {
      res.status(401).json({ message: "Test user not found in allowed_users" });
      return true;
    }
    (req as { user?: unknown }).user = {
      id: testUserId,
      claims: { sub: testUserId },
      role: roleAndOrg.role,
      orgId: roleAndOrg.orgId,
      isOwner: roleAndOrg.role === "SUPER_ADMIN",
      isAllowed: true,
      isPending: false,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };
    next();
    return true;
  } catch (err) {
    console.error("[Auth] Phase2D test user lookup failed:", err);
    res.status(500).json({ message: "Test user lookup failed" });
    return true;
  }
}

export async function tryDevAuthBypass(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<boolean> {
  if (!isDevAuthBypassEnabled()) return false;
  const devUserId = process.env.DEV_AUTH_USER_ID || "dev-user";
  let role = "SUPER_ADMIN";
  let orgId: string | null = null;
  try {
    const roleAndOrg = await storage.getUserRoleAndOrg(devUserId);
    if (roleAndOrg) {
      role = roleAndOrg.role;
      orgId = roleAndOrg.orgId;
    }
  } catch {
    /* SUPER_ADMIN defaults */
  }
  req.user = req.user || {
    id: devUserId,
    username: "Developer",
    email: "dev@example.com",
    isAnonymous: false,
    isOwner: role === "SUPER_ADMIN",
    isAllowed: true,
    isPending: false,
    role,
    orgId,
    claims: { sub: devUserId, email: "dev@example.com", name: "Developer" },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
  next();
  return true;
}

export const isOwner: RequestHandler = async (req, res, next) => {
  if (isDevAuthBypassEnabled()) return next();
  const user = req.user as { isOwner?: boolean } | undefined;
  if (!user?.isOwner) {
    return res.status(403).json({ message: "Access denied. Owner only." });
  }
  return next();
};

export function requireRole(...allowedRoles: string[]): RequestHandler {
  return async (req, res, next) => {
    if (isDevAuthBypassEnabled()) return next();
    const user = req.user as { role?: string; isOwner?: boolean } | undefined;
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const role = user.role ?? (user.isOwner ? "SUPER_ADMIN" : "CASHIER");
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        message: `Access denied. Requires role: ${allowedRoles.join(" or ")}`,
      });
    }
    return next();
  };
}

async function resolveLocationFromOpenShift(orgId: string, userId: string): Promise<string | null> {
  const [open] = await db
    .select({ locationId: shifts.locationId })
    .from(shifts)
    .where(and(eq(shifts.orgId, orgId), eq(shifts.userId, userId), eq(shifts.status, "open")))
    .limit(1);
  return open?.locationId ?? null;
}

export const requireOrgContext: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user as {
      id?: string;
      role?: string;
      isOwner?: boolean;
      orgId?: string | null;
      defaultLocationId?: string;
    } | undefined;
    if (!user) return next();
    const role = user.role ?? (user.isOwner ? "SUPER_ADMIN" : "CASHIER");
    const userOrgId = user.orgId ?? null;
    const headerOrg = req.headers["x-org-id"] as string;
    const queryOrg = req.query?.orgId as string;
    let orgId = role === "SUPER_ADMIN" ? headerOrg || queryOrg || null : userOrgId;
    if (role === "SUPER_ADMIN" && !orgId) {
      const orgs = await storage.listOrganizations();
      if (orgs.length === 1) orgId = orgs[0].id;
    }
    let locationId =
      (req.headers["x-location-id"] as string) || user.defaultLocationId || null;
    if (!locationId && orgId && user.id) {
      locationId = await resolveLocationFromOpenShift(orgId, user.id);
    }
    (req as { orgContext?: unknown }).orgContext = {
      orgId: orgId || null,
      locationId: locationId || null,
      role,
    };
    return next();
  } catch (error) {
    console.error("[requireOrgContext]", error);
    return res.status(500).json({ message: "Failed to resolve organization context" });
  }
};

export const requireOrgScope: RequestHandler = async (req, res, next) => {
  const ctx = (req as { orgContext?: { orgId: string | null; role: string } }).orgContext;
  if (!ctx) return next();
  if (!ctx.orgId) {
    return res.status(403).json({
      message:
        ctx.role === "SUPER_ADMIN"
          ? "Organization required. Pass X-Org-Id or ?orgId= to scope."
          : "No organization assigned. Contact an administrator.",
    });
  }
  return next();
};
