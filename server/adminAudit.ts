import type { Request } from "express";
import type { InsertAdminAuditLog } from "@shared/schema";
import { storage } from "./storage";

type AdminAuditParams = {
  actorUserId: string;
  actorRole: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  orgId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** The row `recordAdminAudit` writes, for callers that must write it in their own transaction. */
export function adminAuditRow(req: Request, params: AdminAuditParams): InsertAdminAuditLog {
  const rawIp = req.ip ?? (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress;
  const ip = rawIp?.replace(/^::ffff:/, "") ?? undefined;
  return {
    orgId: params.orgId ?? undefined,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    action: params.action,
    targetType: params.targetType ?? undefined,
    targetId: params.targetId ?? undefined,
    metadata: params.metadata ?? undefined,
    ipAddress: ip,
    userAgent: req.get("user-agent") ?? undefined,
  };
}

export async function recordAdminAudit(req: Request, params: AdminAuditParams): Promise<void> {
  try {
    await storage.insertAdminAuditLog(adminAuditRow(req, params));
  } catch (e) {
    console.error("[AdminAudit] insert failed:", e);
  }
}
