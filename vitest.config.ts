import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  // tsconfig sets `jsx: "preserve"` (correct for the Vite build), so tests that
  // import .tsx modules need an explicit JSX transform. Vitest 2 applied one
  // implicitly; Vitest 4 does not, and fails import analysis without this.
  plugins: [react()],
  test: {
    environment: "node",
    include: [
      "server/__tests__/**/*.test.ts",
      "client/src/**/__tests__/**/*.test.ts",
      "shared/**/*.spec.ts",
    ],
    exclude: process.env.DATABASE_URL
      ? []
      : [
          "server/__tests__/orderOutboxAtomicity.test.ts",
          "server/__tests__/devAuthBypass.integration.test.ts",
          "server/__tests__/whatsappStore.integration.test.ts",
          "server/__tests__/purchasingPipeline.integration.test.ts",
          // Phase 6 integrity suites — all import ../db at module level.
          "server/__tests__/integrityIdempotency.test.ts",
          "server/__tests__/integrityConcurrency.test.ts",
          "server/__tests__/integrityRollback.test.ts",
          "server/__tests__/integrityReconciliation.test.ts",
          "server/__tests__/integrityMigration.test.ts",
        ],
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client/src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
