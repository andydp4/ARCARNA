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

export function registerAdminRoutes(app: Express): void {

  app.get(
    "/api/admin/audit-logs",
    isAuthenticated,
    requireRole("SUPER_ADMIN"),
    requireSuperAdminMfa,
    async (req: any, res) => {
      try {
        const limit = Math.min(parseInt(String(req.query.limit || "100"), 10) || 100, 500);
        const offset = parseInt(String(req.query.offset || "0"), 10) || 0;
        const rows = await storage.listAdminAuditLogs({ limit, offset });
        res.json(rows);
      } catch (error) {
        console.error("Error fetching audit logs:", error);
        res.status(500).json({ message: "Failed to fetch audit logs" });
      }
    },
  );

  // Get allowed users list (owner only)
  app.get("/api/admin/allowed-users", isAuthenticated, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const replitUserId = req.user.claims?.sub ?? req.user.id;
      const roleAndOrg = await storage.getUserRoleAndOrg(replitUserId);
      const role =
        req.user.role ??
        roleAndOrg?.role ??
        (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");
      const headerOrg = req.headers["x-org-id"] as string | undefined;
      const queryOrg = req.query?.orgId as string | undefined;
      const users =
        role === "SUPER_ADMIN" && !headerOrg && !queryOrg
          ? await storage.adminGetAllAllowedUsers()
          : await storage.getAllowedUsers(
              headerOrg || queryOrg || roleAndOrg?.orgId || "",
            );
      res.json(users);
    } catch (error) {
      console.error("Error fetching allowed users:", error);
      res.status(500).json({ message: "Failed to fetch allowed users" });
    }
  });

  // Remove allowed user (owner only)
  app.delete("/api/admin/allowed-users/:replitUserId", isAuthenticated, requireRole('SUPER_ADMIN', 'ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { replitUserId } = req.params;
      
      // Prevent owner from removing themselves
      const owner = await storage.getOwner();
      if (owner && owner.replitUserId === replitUserId) {
        return res.status(400).json({ message: "Cannot remove owner from allowed users" });
      }
      
      await storage.removeAllowedUser(replitUserId);
      const actorId = req.user.claims?.sub ?? req.user.id;
      const rob = await storage.getUserRoleAndOrg(actorId);
      const actorRole =
        req.user.role ?? rob?.role ?? (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");
      await recordAdminAudit(req, {
        actorUserId: actorId,
        actorRole,
        action: "access.remove_allowed_user",
        targetType: "allowed_user",
        targetId: replitUserId,
        orgId: rob?.orgId ?? null,
      });
      res.json({ message: "User removed from allowed list" });
    } catch (error) {
      console.error("Error removing allowed user:", error);
      res.status(500).json({ message: "Failed to remove user" });
    }
  });

  // Get pending approval requests (owner only)
  app.get("/api/admin/pending-approvals", isAuthenticated, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const requests = await storage.getPendingApprovals();
      res.json(requests);
    } catch (error) {
      console.error("Error fetching pending approvals:", error);
      res.status(500).json({ message: "Failed to fetch pending approvals" });
    }
  });

  app.patch("/api/admin/allowed-users/:replitUserId", isAuthenticated, requireRole('SUPER_ADMIN', 'ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { replitUserId } = req.params;
      const actorId = req.user.claims?.sub ?? req.user.id;
      const roleAndOrg = await storage.getUserRoleAndOrg(actorId);
      const actorRole =
        (req.user.role ??
          roleAndOrg?.role ??
          (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER")) as Role;
      const { role, orgId } = req.body ?? {};
      if (role && !isRole(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      if (role && !canAssignRole(actorRole, role)) {
        return res.status(403).json({ message: "You cannot assign this role" });
      }
      const headerOrg = req.headers["x-org-id"] as string | undefined;
      const queryOrg = req.query?.orgId as string | undefined;
      const allInScope =
        actorRole === "SUPER_ADMIN" && !headerOrg && !queryOrg
          ? await storage.adminGetAllAllowedUsers()
          : await storage.getAllowedUsers(
              headerOrg || queryOrg || roleAndOrg?.orgId || "",
            );
      const targetUser = allInScope.find((u) => u.replitUserId === replitUserId);
      if (!targetUser) return res.status(404).json({ message: "User not found" });
      if (!canManageUser(actorRole, roleAndOrg?.orgId ?? null, targetUser.orgId ?? null)) {
        return res.status(403).json({ message: "Access denied" });
      }
      const updated = await storage.updateAllowedUserAccess(
        replitUserId,
        { role, orgId },
        { role: actorRole, orgId: roleAndOrg?.orgId ?? null, replitUserId: actorId },
      );
      await recordAdminAudit(req, {
        actorUserId: actorId,
        actorRole,
        action: "access.update_allowed_user",
        targetType: "allowed_user",
        targetId: replitUserId,
        orgId: roleAndOrg?.orgId ?? null,
        metadata: { role, orgId },
      });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating allowed user:", error);
      res.status(400).json({ message: error.message || "Failed to update user" });
    }
  });

  // Approve user (owner only)
  app.post("/api/admin/approve/:replitUserId", isAuthenticated, requireRole('SUPER_ADMIN', 'ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { replitUserId } = req.params;
      const approvedBy = req.user.claims?.sub ?? req.user.id;
      const { role, orgId } = req.body ?? {};
      if (role && !isRole(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      const actorRoleAndOrg = await storage.getUserRoleAndOrg(approvedBy);
      const actorRole = (req.user.role ??
        actorRoleAndOrg?.role ??
        (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER")) as Role;
      if (role && !canAssignRole(actorRole, role)) {
        return res.status(403).json({ message: "You cannot assign this role" });
      }
      const effectiveOrgId =
        orgId !== undefined ? orgId : actorRole === "SUPER_ADMIN" ? orgId : actorRoleAndOrg?.orgId ?? null;
      if (actorRole === "ADMIN" && effectiveOrgId !== actorRoleAndOrg?.orgId) {
        return res.status(403).json({ message: "Cannot assign users outside your organization" });
      }
      await storage.approveUser(replitUserId, approvedBy, { role: role ?? "CASHIER", orgId: effectiveOrgId });
      await recordAdminAudit(req, {
        actorUserId: approvedBy,
        actorRole,
        action: "access.approve",
        targetType: "allowed_user",
        targetId: replitUserId,
        orgId: effectiveOrgId ?? null,
        metadata: { role: role ?? "CASHIER" },
      });
      res.json({ message: "User approved successfully" });
    } catch (error: any) {
      console.error("Error approving user:", error);
      res.status(400).json({ message: error.message || "Failed to approve user" });
    }
  });

  // Reject user (owner only)
  app.post("/api/admin/reject/:replitUserId", isAuthenticated, requireRole('SUPER_ADMIN', 'ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { replitUserId } = req.params;
      const rejectedBy = req.user.claims?.sub || req.user.id || "owner";
      const rob = await storage.getUserRoleAndOrg(rejectedBy);
      const actorRole =
        req.user.role ?? rob?.role ?? (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");

      await storage.rejectUser(replitUserId, rejectedBy);
      await recordAdminAudit(req, {
        actorUserId: rejectedBy,
        actorRole,
        action: "access.reject",
        targetType: "allowed_user",
        targetId: replitUserId,
        orgId: rob?.orgId ?? null,
      });
      res.json({ message: "User rejected" });
    } catch (error) {
      console.error("Error rejecting user:", error);
      res.status(500).json({ message: "Failed to reject user" });
    }
  });

  // Pending approval page — identity only (no allow-list gate; Clerk has no passport session)
  app.get("/api/auth/approval-status", async (req: any, res) => {
    try {
      const { resolveRequestIdentity } = await import("../auth/identity");
      const identity = await resolveRequestIdentity(req);
      if (!identity) {
        return res.status(401).json({ authenticated: false });
      }

      const { subjectId } = identity;
      const isAllowed = await storage.isUserAllowed(subjectId);
      const approvalRequest = await storage.getApprovalRequest(subjectId);

      res.json({
        authenticated: true,
        isAllowed,
        isPending: approvalRequest?.status === "pending",
        isRejected: approvalRequest?.status === "rejected",
        name: identity.name || "User",
        email: identity.email ?? null,
      });
    } catch (error) {
      console.error("Error checking approval status:", error);
      res.status(500).json({ message: "Failed to check approval status" });
    }
  });
}
