import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";

export function normalizeViteBasePath(basePath: string | undefined): string {
  return (basePath || "/").replace(/\/?$/, "/");
}

export function loadBuildEnv(mode: string, envDir: string): Record<string, string> {
  return loadEnv(mode, envDir, "");
}

export default defineConfig(({ mode }) => {
  const envDir = path.resolve(import.meta.dirname);
  const env = loadBuildEnv(mode, envDir);
  // Vite exposes envDir-loaded VITE_* values to client code, but config-time
  // options such as `base` must read that same source explicitly.
  const appBase = normalizeViteBasePath(process.env.VITE_BASE_PATH || env.VITE_BASE_PATH);
  const sentryAuthToken = (process.env.SENTRY_AUTH_TOKEN || env.SENTRY_AUTH_TOKEN || "").trim();

  return {
    base: appBase,
    plugins: [
      react(),
      ...(sentryAuthToken
        ? [
            sentryVitePlugin({
              org: process.env.SENTRY_ORG || env.SENTRY_ORG,
              project: process.env.SENTRY_PROJECT || env.SENTRY_PROJECT,
              authToken: sentryAuthToken,
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
        "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      },
    },
    root: path.resolve(import.meta.dirname, "client"),
    // Without this, Vite's automatic .env loading defaults to `root` (client/)
    // instead of the repo root where the real .env lives, so import.meta.env.*
    // vars (like VITE_BASE_PATH) silently resolve to undefined at build time.
    envDir,
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
      sourcemap: sentryAuthToken ? "hidden" : false,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            // Safari: keep React, Clerk, and Recharts in the main bundle (no separate vendor chunks).
            if (id.includes("@radix-ui")) return "vendor-radix";
            if (id.includes("@tanstack/react-query")) return "vendor-query";
          },
        },
      },
    },
    server: {
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
  };
});
