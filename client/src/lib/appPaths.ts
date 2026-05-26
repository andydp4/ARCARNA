import { apiPathWithBase, normalizeAppBasePath, withAppBase } from "@shared/appPaths";

/** Client mount path, e.g. `/midnight` (from VITE_BASE_PATH). */
export const APP_BASE = normalizeAppBasePath(
  (import.meta.env.VITE_BASE_PATH as string | undefined) ?? "/midnight",
);

export function resolveAppPath(path: string): string {
  return withAppBase(APP_BASE, path);
}

export function resolveApiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return apiPathWithBase(APP_BASE, path);
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(resolveApiUrl(input), init);
}
