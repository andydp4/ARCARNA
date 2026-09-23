import {
  migrateStorageKey,
  STORAGE_ORG_ID,
  STORAGE_ORG_ID_LEGACY,
} from "@shared/storageKeys";
import { previewRoleHeaders } from "./previewRole";

export function getSelectedOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return migrateStorageKey(STORAGE_ORG_ID_LEGACY, STORAGE_ORG_ID);
}

export function setSelectedOrgId(orgId: string | null): void {
  if (typeof window === "undefined") return;
  if (orgId) localStorage.setItem(STORAGE_ORG_ID, orgId);
  else localStorage.removeItem(STORAGE_ORG_ID);
}

/** Org scope only — no preview header (used to start/stop a preview itself). */
export function orgOnlyHeaders(): Record<string, string> {
  const orgId = getSelectedOrgId();
  return orgId ? { "X-Org-Id": orgId } : {};
}

export function orgScopeHeaders(): Record<string, string> {
  return {
    ...orgOnlyHeaders(),
    // "Preview as role": every API call carries it while a preview is on.
    ...previewRoleHeaders(),
  };
}
