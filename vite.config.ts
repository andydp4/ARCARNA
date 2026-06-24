import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";
import fs from "fs";

const appBase = (process.env.VITE_BASE_PATH || "/arcarna").replace(/\/?$/, "/");
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();

/**
 * manifest.json's start_url/scope/icon paths are copied verbatim from
 * public/ — Vite's `base` rewrite only touches asset references inside
 * index.html, not raw JSON content. Patch them post-build so a root-mounted
 * subdomain build (VITE_BASE_PATH=/) doesn't ship a manifest still pointing
 * PWA installs at /arcarna/.
 */
function rewriteManifestBasePlugin() {
  return {
    name: "rewrite-manifest-base",
    closeBundle() {
      const manifestPath = path.join(
        path.resolve(import.meta.dirname, process.env.DIST_PUBLIC_DIR ?? "dist/public"),
        "manifest.json",
      );
      if (!fs.existsSync(manifestPath)) return;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      manifest.start_url = appBase;
      manifest.scope = appBase;
      if (Array.isArray(manifest.icons)) {
        manifest.icons = manifest.icons.map((icon: { src: string }) => ({
          ...icon,
          src: appBase + icon.src.replace(/^\/[^/]+\//, ""),
        }));
      }
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    },
  };
}

export default defineConfig({
  base: appBase,
  plugins: [
    react(),
    rewriteManifestBasePlugin(),
    ...(sentryAuthToken
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
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
  build: {
    outDir: path.resolve(import.meta.dirname, process.env.DIST_PUBLIC_DIR ?? "dist/public"),
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
});
