import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import fs from "node:fs";
import path from "path";

// Default to site root (subdomain deploy). Override with VITE_BASE_PATH for a
// path-mounted build (e.g. VITE_BASE_PATH=/arcarna npm run build).
const appBase = (process.env.VITE_BASE_PATH || "/").replace(/\/?$/, "/");
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();
const publicOutDir = path.resolve(import.meta.dirname, "dist/public");

function deleteFilesRecursively(dir: string, shouldDelete: (filePath: string) => boolean) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      deleteFilesRecursively(fullPath, shouldDelete);
    } else if (shouldDelete(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }
}

function deletePublicSourcemapsPlugin(): Plugin {
  return {
    name: "delete-public-sourcemaps",
    apply: "build",
    enforce: "post",
    closeBundle() {
      deleteFilesRecursively(publicOutDir, (filePath) => filePath.endsWith(".map"));
    },
  };
}

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
          // Defense in depth for the exact production failure this block is
          // guarding: if the Sentry upload logs a 401 but the build still exits
          // 0, public sourcemaps must not be left behind for static serving.
          deletePublicSourcemapsPlugin(),
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
    outDir: publicOutDir,
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
