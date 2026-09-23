/**
 * "Preview as role" (CMP-09), client side. The previewed role lives in
 * sessionStorage (this tab only, gone when the tab closes) and rides on every
 * API call as X-Preview-Role via orgScopeHeaders(); the server applies it
 * (server/auth/previewRole.ts), so what you see is what that role really gets.
 */
import { withClerkAuthHeaders } from "./clerkApiAuth";
import { resolveApiUrl } from "./appPaths";

export const PREVIEW_ROLE_STORAGE_KEY = "arcarna:preview-role";
export const PREVIEWABLE_ROLES = ["MANAGER", "CASHIER"] as const;
export type PreviewableRole = (typeof PREVIEWABLE_ROLES)[number];

function store(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function getPreviewRole(): PreviewableRole | null {
  try {
    const value = store()?.getItem(PREVIEW_ROLE_STORAGE_KEY);
    return value && (PREVIEWABLE_ROLES as readonly string[]).includes(value) ? (value as PreviewableRole) : null;
  } catch {
    return null;
  }
}

/** Drop any preview without an audit call (sign-out, or the server refusing it). */
export function clearPreviewRole(): void {
  try {
    store()?.removeItem(PREVIEW_ROLE_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was stored either.
  }
}

export function previewRoleHeaders(): Record<string, string> {
  const role = getPreviewRole();
  return role ? { "X-Preview-Role": role } : {};
}

/** Record the start/end for the audit log. Sent without the preview header on purpose. */
async function recordPreview(role: PreviewableRole | null, orgHeaders: Record<string, string>): Promise<void> {
  const headers = await withClerkAuthHeaders({ ...orgHeaders, "Content-Type": "application/json" });
  const res = await fetch(resolveApiUrl("/api/auth/preview-role"), {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message || "Could not start the preview");
  }
}

/**
 * Switch preview on/off and reload, so no data fetched as one role is shown
 * as the other (react-query caches, open pages, the board stream).
 */
export async function setPreviewRole(
  role: PreviewableRole | null,
  orgHeaders: Record<string, string>,
  reload: (path: string) => void = (p) => window.location.assign(p),
  homePath = "/",
): Promise<void> {
  await recordPreview(role, orgHeaders).catch((err) => {
    // Ending a preview must always work, even if the audit call fails.
    if (role) throw err;
  });
  const s = store();
  if (role) s?.setItem(PREVIEW_ROLE_STORAGE_KEY, role);
  else s?.removeItem(PREVIEW_ROLE_STORAGE_KEY);
  reload(homePath);
}
