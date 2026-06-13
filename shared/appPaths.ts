/** Normalize app mount path (no trailing slash). Empty string = site root. */
export function normalizeAppBasePath(raw?: string | null): string {
  const value = (raw ?? "/arcarna").trim();
  if (!value || value === "/") return "";
  const withLeading = value.startsWith("/") ? value : `/${value}`;
  return withLeading.replace(/\/+$/, "");
}

export function withAppBase(base: string, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

export function apiPathWithBase(base: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const api = p.startsWith("/api") ? p : `/api${p}`;
  return withAppBase(base, api);
}
