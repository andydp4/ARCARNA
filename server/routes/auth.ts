import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { isAuthenticated, isOwner, requireRole, requireOrgContext, requireOrgScope, requireSuperAdminMfa } from "../auth";
import { getAuthRuntimeSnapshot, getAuthProvider } from "../authRuntime";
import { canAssignRole, canManageUser, isRole } from "@shared/rbac";
import type { Role } from "@shared/schema";
import { recordAdminAudit } from "../adminAudit";
import { canPreview, isPreviewableRole, previewOf } from "../auth/previewRole";
import { listSeenUiKeys } from "../services/uiSeen";
import { isOnboardingComplete, parseOnboardingState } from "@shared/onboarding";
import {
  insertLoyaltyTierSchema,
  insertPromotionSchema,
  insertOrderSchema,
  insertCustomerSchema,
  insertProductSchema,
  insertOverheadExpenseSchema,
  insertOrderExpenseSchema,
} from "@shared/schema";
import { sendServerError } from "../lib/errorScrub";

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const replitUserId = req.user.claims?.sub ?? req.user.id;
      const user = await storage.getUser(replitUserId);
      const roleAndOrg = await storage.getUserRoleAndOrg(replitUserId);
      const role =
        req.user.role ??
        roleAndOrg?.role ??
        (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");
      const orgId = req.user.orgId ?? roleAndOrg?.orgId ?? null;
      let orgName: string | null = null;
      const headerOrg = req.headers["x-org-id"] as string | undefined;
      const setupOrgId =
        role === "SUPER_ADMIN" ? headerOrg || orgId || null : orgId;
      let setupComplete = true;
      let needsOrgOnboarding = false;
      if (setupOrgId) {
        const org = await storage.getOrganization(setupOrgId);
        orgName = org?.name ?? orgName;
        setupComplete = org?.setupComplete === 1;
        if (org) {
          const ob = parseOnboardingState(org.onboardingState);
          needsOrgOnboarding = !isOnboardingComplete(ob);
        }
      }
      const orgCount = await storage.countOrganizations();
      let accessState: "ok" | "pending" | "no_org" | "no_access" = "ok";
      if (req.user.isPending || req.user.isAllowed === false) {
        accessState = "pending";
      } else if (role !== "SUPER_ADMIN" && !orgId) {
        accessState = "no_org";
      } else if (role === "SUPER_ADMIN" && orgCount === 0) {
        accessState = "no_org";
      }

      let clerkTwoFactorEnabled: boolean | null = null;
      if (role === "SUPER_ADMIN" && getAuthProvider() === "clerk") {
        try {
          const { getAuth, clerkClient } = await import("@clerk/express");
          const { userId } = getAuth(req);
          if (userId) {
            const cu = await clerkClient.users.getUser(userId);
            clerkTwoFactorEnabled = !!cu.twoFactorEnabled;
          }
        } catch {
          clerkTwoFactorEnabled = null;
        }
      }

      // Per-account "already seen" markers for What's New / tours. Never
      // allowed to fail sign-in: if the table is missing (migration 069 not
      // yet applied) the client falls back to its own per-device flag.
      let seenUi: string[] = [];
      try {
        seenUi = await listSeenUiKeys(replitUserId);
      } catch (e) {
        console.warn("[auth] could not load seen UI markers:", e);
      }

      res.json({
        ...user,
        // The signed-in identity, even when no users row exists yet (a first
        // sign-in, or an impersonated test user): screens key on user.id —
        // My run found nothing to load without it.
        id: user?.id ?? replitUserId,
        role,
        orgId,
        orgName,
        seenUi,
        isAllowed: req.user.isAllowed !== false,
        isPending: !!req.user.isPending,
        accessState,
        needsOnboarding: role === "SUPER_ADMIN" && orgCount === 0,
        needsOrgOnboarding,
        setupComplete,
        needsSetupWizard: !!setupOrgId && !setupComplete && !needsOrgOnboarding,
        runtime: getAuthRuntimeSnapshot(),
        clerkTwoFactorEnabled,
        // Set while an admin previews a lower role (X-Preview-Role): `role`
        // above is the previewed one, this says who is really looking.
        preview: previewOf(req) ?? null,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  /**
   * Start or end "Preview as role" — only an audit record; the preview itself
   * is the X-Preview-Role header (server/auth/previewRole.ts). Sent WITHOUT
   * that header, so it is the admin's own request, not the previewed role's.
   */
  app.post("/api/auth/preview-role", isAuthenticated, async (req: any, res) => {
    const realRole = req.user?.role ?? (req.user?.isOwner ? "SUPER_ADMIN" : "CASHIER");
    if (!canPreview(realRole)) {
      return res.status(403).json({ code: "PREVIEW_NOT_ALLOWED", message: "Only admins can preview another role." });
    }
    const role = req.body?.role ?? null;
    if (role !== null && !isPreviewableRole(role)) {
      return res.status(400).json({ code: "PREVIEW_ROLE_INVALID", message: "You can preview as Manager or Cashier." });
    }
    const headerOrg = req.headers["x-org-id"] as string | undefined;
    await recordAdminAudit(req, {
      actorUserId: req.user?.claims?.sub ?? req.user?.id ?? "unknown",
      actorRole: realRole,
      action: role ? "preview_role.started" : "preview_role.ended",
      targetType: "role",
      targetId: role,
      orgId: realRole === "SUPER_ADMIN" ? headerOrg || req.user?.orgId || null : req.user?.orgId ?? null,
    });
    res.json({ ok: true, role });
  });

  app.get("/api/auth/bootstrap", isAuthenticated, async (req: any, res) => {
    try {
      const replitUserId = req.user.claims?.sub ?? req.user.id;
      const roleAndOrg = await storage.getUserRoleAndOrg(replitUserId);
      const role =
        req.user.role ??
        roleAndOrg?.role ??
        (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");
      const orgCount = await storage.countOrganizations();
      const orgs = role === "SUPER_ADMIN" ? await storage.listOrganizations() : [];
      res.json({
        role,
        orgId: roleAndOrg?.orgId ?? null,
        orgCount,
        needsOnboarding: role === "SUPER_ADMIN" && orgCount === 0,
        organizations: orgs,
      });
    } catch (error) {
      console.error("Error fetching bootstrap:", error);
      res.status(500).json({ message: "Failed to fetch bootstrap state" });
    }
  });

  // Organization management
  app.get("/api/orgs", isAuthenticated, async (req: any, res) => {
    try {
      const replitUserId = req.user.claims?.sub ?? req.user.id;
      const roleAndOrg = await storage.getUserRoleAndOrg(replitUserId);
      const role =
        req.user.role ??
        roleAndOrg?.role ??
        (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");
      if (role === "SUPER_ADMIN") {
        return res.json(await storage.listOrganizations());
      }
      const orgId = roleAndOrg?.orgId;
      if (!orgId) return res.json([]);
      const org = await storage.getOrganization(orgId);
      res.json(org ? [org] : []);
    } catch (error) {
      console.error("Error listing organizations:", error);
      res.status(500).json({ message: "Failed to list organizations" });
    }
  });

  app.post("/api/orgs", isAuthenticated, requireRole("SUPER_ADMIN"), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const name = String(req.body?.name ?? "").trim();
      if (!name) return res.status(400).json({ message: "Organization name is required" });
      const org = await storage.createOrganization(name);
      const actorId = req.user.claims?.sub ?? req.user.id;
      const roleAndOrg = await storage.getUserRoleAndOrg(actorId);
      const actorRole =
        req.user.role ?? roleAndOrg?.role ?? (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");
      await recordAdminAudit(req, {
        actorUserId: actorId,
        actorRole,
        action: "org.create",
        targetType: "organization",
        targetId: org.id,
        orgId: org.id,
        metadata: { name },
      });
      res.status(201).json(org);
    } catch (error: any) {
      console.error("Error creating organization:", error);
      sendServerError(res, error, "Failed to create organization");
    }
  });

  app.patch("/api/orgs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const name = String(req.body?.name ?? "").trim();
      if (!name) return res.status(400).json({ message: "Organization name is required" });
      const replitUserId = req.user.claims?.sub ?? req.user.id;
      const roleAndOrg = await storage.getUserRoleAndOrg(replitUserId);
      const role =
        req.user.role ??
        roleAndOrg?.role ??
        (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");
      if (role === "SUPER_ADMIN") {
        const org = await storage.updateOrganizationName(id, name);
        return res.json(org);
      }
      if (role === "ADMIN" && roleAndOrg?.orgId === id) {
        const org = await storage.updateOrganizationName(id, name);
        return res.json(org);
      }
      return res.status(403).json({ message: "Access denied" });
    } catch (error: any) {
      console.error("Error updating organization:", error);
      if (error.message === "Organization not found") {
        return res.status(404).json({ message: "Organization not found" });
      }
      sendServerError(res, error, "Failed to update organization");
    }
  });
}
