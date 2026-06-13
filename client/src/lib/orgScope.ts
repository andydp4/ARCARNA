import {
  migrateStorageKey,
  STORAGE_ORG_ID,
  STORAGE_ORG_ID_LEGACY,
} from "@shared/storageKeys";

export function getSelectedOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return migrateStorageKey(STORAGE_ORG_ID_LEGACY, STORAGE_ORG_ID);
}

export function setSelectedOrgId(orgId: string | null): void {
  if (typeof window === "undefined") return;
  if (orgId) localStorage.setItem(STORAGE_ORG_ID, orgId);
  else localStorage.removeItem(STORAGE_ORG_ID);
}

export function orgScopeHeaders(): Record<string, string> {
  const orgId = getSelectedOrgId();
  return orgId ? { "X-Org-Id": orgId } : {};
}
