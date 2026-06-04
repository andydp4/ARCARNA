import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 5000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

const e2eEnv: Record<string, string> = {
  NODE_ENV: "development",
  PORT: String(port),
  DEV_AUTH_BYPASS: "1",
  SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-test-session-secret-32chars-min",
  APP_BASE_PATH: "/midnight",
  VITE_BASE_PATH: "/midnight",
};

if (process.env.DATABASE_URL) {
  e2eEnv.DATABASE_URL = process.env.DATABASE_URL;
}

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
  },
  webServer: {
    command: "npm run dev:e2e",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: e2eEnv,
  },
  projects: [
    { name: "e2e", testDir: "tests/e2e" },
    { name: "a11y", testDir: "tests/a11y" },
    { name: "visual", testDir: "tests/visual" },
  ],
});
