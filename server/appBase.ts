import { normalizeAppBasePath } from "@shared/appPaths";

export const APP_BASE_PATH = normalizeAppBasePath(
  process.env.APP_BASE_PATH ?? process.env.VITE_BASE_PATH ?? "/midnight",
);
