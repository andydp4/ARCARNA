import type { Request } from "express";
import { storage } from "./storage";

export async function recordAdminAudit(
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
): Promise<void> {
  try {
    const rawIp = req.ip ?? (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress;
    const ip = rawIp?.replace(/^::ffff:/, "") ?? undefined;
    await storage.insertAdminAuditLog({
      orgId: params.orgId ?? undefined,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      action: params.action,
      targetType: params.targetType ?? undefined,
      targetId: params.targetId ?? undefined,
      metadata: params.metadata ?? undefined,
      ipAddress: ip,
      userAgent: req.get("user-agent") ?? undefined,
    });
  } catch (e) {
    console.error("[AdminAudit] insert failed:", e);
  }
}
