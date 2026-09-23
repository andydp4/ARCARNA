/**
 * "Preview as role" (CMP-09): a SUPER_ADMIN or ADMIN sees the app exactly as a
 * MANAGER or CASHIER would, through the same server-side role checks and
 * serialisers (productForRole, report filters, requireRole, ...), without a
 * second login.
 *
 * The client sends `X-Preview-Role`. After the real sign-in succeeds, this
 * swaps the request's user to the previewed role for THAT request only
 * (a copy — the session's own user object is never modified), so every
 * downstream check sees the lower role. Preview is read-only: anything but
 * GET/HEAD/OPTIONS is refused, so previewing can never change data or
 * permissions. Starting and ending a preview is audit-logged
 * (POST /api/auth/preview-role, sent without the header).
 */
import type { NextFunction, Request, Response } from "express";
import { storage } from "../storage";

export const PREVIEW_ROLE_HEADER = "x-preview-role";
export const PREVIEWABLE_ROLES = ["MANAGER", "CASHIER"] as const;
export type PreviewableRole = (typeof PREVIEWABLE_ROLES)[number];
/** Who may preview. Only roles strictly above every previewable role. */
export const PREVIEW_CAPABLE_ROLES = ["SUPER_ADMIN", "ADMIN"] as const;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface PreviewState {
  role: PreviewableRole;
  realRole: string;
}

type SessionUser = {
  role?: string;
  isOwner?: boolean;
  orgId?: string | null;
  preview?: PreviewState;
  [key: string]: unknown;
};

export function isPreviewableRole(value: unknown): value is PreviewableRole {
  return typeof value === "string" && (PREVIEWABLE_ROLES as readonly string[]).includes(value);
}

export function canPreview(realRole: string | undefined): boolean {
  return !!realRole && (PREVIEW_CAPABLE_ROLES as readonly string[]).includes(realRole);
}

export function previewOf(req: Request): PreviewState | undefined {
  return (req.user as SessionUser | undefined)?.preview;
}

function realRoleOf(user: SessionUser): string {
  return user.role ?? (user.isOwner ? "SUPER_ADMIN" : "CASHIER");
}

/**
 * The org the previewed role is pinned to. An ADMIN has one org. The owner's
 * login has no fixed org (they pick one with X-Org-Id), and a MANAGER/CASHIER
 * never gets to pick, so the org is resolved here, before the role drops.
 */
async function previewOrgId(req: Request, user: SessionUser, realRole: string): Promise<string | null> {
  if (realRole !== "SUPER_ADMIN") return user.orgId ?? null;
  const picked = (req.headers["x-org-id"] as string | undefined) || (req.query?.orgId as string | undefined);
  if (picked) return picked;
  if (user.orgId) return user.orgId;
  const orgs = await storage.listOrganizations();
  return orgs.length === 1 ? orgs[0].id : null;
}

/** Runs after sign-in. No header: nothing changes. */
export async function applyPreviewRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  const raw = req.headers[PREVIEW_ROLE_HEADER];
  // EventSource (the board stream) cannot set headers, so a GET may carry it
  // as ?previewRole= instead — same rules, and GETs are all a preview allows.
  const fromQuery = req.method === "GET" && typeof req.query?.previewRole === "string" ? req.query.previewRole : undefined;
  const requested = ((Array.isArray(raw) ? raw[0] : raw) ?? fromQuery)?.trim().toUpperCase();
  if (!requested) return next();

  const user = req.user as SessionUser | undefined;
  if (!user) return next();
  const realRole = realRoleOf(user);

  if (!canPreview(realRole)) {
    res.status(403).json({ code: "PREVIEW_NOT_ALLOWED", message: "Only admins can preview another role." });
    return;
  }
  if (!isPreviewableRole(requested)) {
    res.status(400).json({ code: "PREVIEW_ROLE_INVALID", message: "You can preview as Manager or Cashier." });
    return;
  }
  if (!READ_METHODS.has(req.method)) {
    res.status(403).json({
      code: "PREVIEW_READ_ONLY",
      message: "You are previewing another role, which is read-only. Exit the preview to make changes.",
    });
    return;
  }

  try {
    const orgId = await previewOrgId(req, user, realRole);
    if (!orgId) {
      res.status(400).json({ code: "PREVIEW_ORG_REQUIRED", message: "Choose a shop before previewing a role." });
      return;
    }
    // A fresh object: the session's own user (passport keeps it in the session
    // store) must never carry the lowered role beyond this request.
    req.user = {
      ...user,
      role: requested,
      isOwner: false,
      orgId,
      preview: { role: requested, realRole },
    } as typeof req.user;
    res.setHeader("X-Preview-Role", requested);
    next();
  } catch (err) {
    next(err);
  }
}
