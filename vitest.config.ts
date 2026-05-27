import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: process.env.DATABASE_URL ? ["server/__tests__/**/*.test.ts"] : [],
    passWithNoTests: true,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
