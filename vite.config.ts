import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";

// Default to site root (subdomain deploy). Override with VITE_BASE_PATH for a
// path-mounted build (e.g. VITE_BASE_PATH=/arcarna npm run build).
function viteBasePath(raw: string | undefined): string {
  if (raw === undefined) return "/";
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "/") return "/";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/?$/, "/");
}

const appBase = viteBasePath(process.env.VITE_BASE_PATH);
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();

export default defineConfig({
  base: appBase,
  plugins: [
    react(),
    ...(sentryAuthToken
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: sentryAuthToken,
            // `sourcemap: "hidden"` below writes .map files into dist/public and
            // omits the //# sourceMappingURL comment — browsers never fetch them,
            // but the server still hosts that directory statically and the .map
            // filenames are derivable from the public .js filenames.
            //
            // The build does not fail when the upload does: an expired
            // SENTRY_AUTH_TOKEN returns 401, the plugin logs it, and the build
            // continues to exit 0. That happened on the 6a020e3 deploy and left
            // every sourcemap fetchable in production. Deleting them after the
            // upload step means the only copy that survives a build is the one
            // in Sentry, where it belongs.
            sourcemaps: {
              filesToDeleteAfterUpload: ["dist/public/**/*.map"],
            },
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  // Without this, Vite's automatic .env loading defaults to `root` (client/)
  // instead of the repo root where the real .env lives, so import.meta.env.*
  // vars (like VITE_BASE_PATH) silently resolve to undefined at build time.
  envDir: path.resolve(import.meta.dirname),
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
});
