import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
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
          "server/__tests__/whatsappStore.integration.test.ts",
        ],
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
