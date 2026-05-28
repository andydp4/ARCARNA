import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { isAuthenticated, isOwner, requireRole, requireOrgContext, requireOrgScope, requireSuperAdminMfa } from "../auth";
import { getAuthRuntimeSnapshot, getAuthProvider } from "../authRuntime";
import { canAssignRole, canManageUser, isRole } from "@shared/rbac";
import type { Role } from "@shared/schema";
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
      if (setupOrgId) {
        const org = await storage.getOrganization(setupOrgId);
        orgName = org?.name ?? orgName;
        setupComplete = org?.setupComplete === 1;
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

      res.json({
        ...user,
        role,
        orgId,
        orgName,
        isAllowed: req.user.isAllowed !== false,
        isPending: !!req.user.isPending,
        accessState,
        needsOnboarding: role === "SUPER_ADMIN" && orgCount === 0,
        setupComplete,
        needsSetupWizard: !!setupOrgId && !setupComplete,
        runtime: getAuthRuntimeSnapshot(),
        clerkTwoFactorEnabled,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
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
      res.status(500).json({ message: error.message || "Failed to create organization" });
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
      res.status(error.message === "Organization not found" ? 404 : 500).json({
        message: error.message || "Failed to update organization",
      });
    }
  });
}
