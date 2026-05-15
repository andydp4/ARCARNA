const STORAGE_KEY = "midnight.selectedOrgId";

export function getSelectedOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function setSelectedOrgId(orgId: string | null): void {
  if (typeof window === "undefined") return;
  if (orgId) localStorage.setItem(STORAGE_KEY, orgId);
  else localStorage.removeItem(STORAGE_KEY);
}

export function orgScopeHeaders(): Record<string, string> {
  const orgId = getSelectedOrgId();
  return orgId ? { "X-Org-Id": orgId } : {};
}
