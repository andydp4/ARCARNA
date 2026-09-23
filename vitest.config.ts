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
          "server/__tests__/customerMetricsDedup.test.ts",
          "server/__tests__/devAuthBypass.integration.test.ts",
          "server/__tests__/whatsappStore.integration.test.ts",
          "server/__tests__/purchasingPipeline.integration.test.ts",
          "server/__tests__/creditCommission.test.ts",
          "server/__tests__/tradingDayShift.test.ts",
          "server/__tests__/dailyClose.test.ts",
          // ARC-020/025 revenue-definition suites: describe.skipIf(!hasDb)
          // gates the test bodies correctly, but the top-level `import {
          // storage } from "../storage"` (storage is used directly inside
          // the tests, so it can't be deferred into beforeEach the way `db`
          // and `settledRevenueByDay` already are here) still reaches
          // server/db.ts at import time regardless of the skip. Same rule as
          // the suites above: needs a live, seeded Postgres, so it's excluded
          // from CI's default (no-DATABASE_URL) run rather than run there.
          "server/__tests__/truthsHubSettledRevenue.test.ts",
          "server/__tests__/profitTruthsSettledRevenue.test.ts",
          // Phase 6 integrity suites — all import ../db at module level.
          "server/__tests__/integrityIdempotency.test.ts",
          "server/__tests__/integrityConcurrency.test.ts",
          "server/__tests__/integrityRollback.test.ts",
          "server/__tests__/integrityReconciliation.test.ts",
          "server/__tests__/integrityMigration.test.ts",
          // Phase N (Operations Centre) DB suites. Same rule as the twelve
          // above — they need a live, seeded Postgres — but a different CI
          // route: the `unit-db` job in .github/workflows/ci.yml runs these
          // five BY NAME rather than running the whole suite with
          // DATABASE_URL set, because that would also switch on the twelve
          // legacy suites above, which have never run in CI and are not in
          // this phase's scope (brief finding G25). Written by N3b, N5a and
          // N7; listed here from N8 so the exclusion exists before the first
          // file lands and no one has to remember to add it.
          "server/__tests__/orderClaimRace.test.ts",
          "server/__tests__/orderTransitionAtomicity.test.ts",
          "server/__tests__/opsBoardQuery.test.ts",
          "server/__tests__/opsAlertSweep.test.ts",
          "server/__tests__/orderTimingReport.test.ts",
          "server/__tests__/opsBoardSuperAdminStaff.test.ts",
          // v1.2 Phase 0B: imports the WhatsApp store, which reaches ../db at
          // load. Runs by name in the unit-db job instead.
          "server/__tests__/whatsappMarketingConsent.test.ts",
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
