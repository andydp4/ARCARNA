import { defineConfig, devices } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const port = Number(process.env.PORT ?? 5000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

/**
 * Shared secret for the localhost-only PHASE2D test-user impersonation the
 * journey suite uses to exercise each role without restarting the server. Dev
 * and test only: the server refuses impersonation unless NODE_ENV is not
 * production, the caller is localhost, and this secret matches.
 */
export const JOURNEY_TEST_SECRET =
  process.env.PHASE2D_TEST_SECRET ?? "journey-suite-local-secret";

const e2eEnv: Record<string, string> = {
  NODE_ENV: "development",
  PORT: String(port),
  DEV_AUTH_BYPASS: "1",
  SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-test-session-secret-32chars-min",
  APP_BASE_PATH: "/",
  VITE_BASE_PATH: "/",
  PHASE2D_TEST: "1",
  PHASE2D_TEST_SECRET: JOURNEY_TEST_SECRET,
};

const appBasePath = (e2eEnv.APP_BASE_PATH ?? "/").replace(/\/$/, "");

if (process.env.DATABASE_URL) {
  e2eEnv.DATABASE_URL = process.env.DATABASE_URL;
}

/**
 * Managed images ship a pinned Chromium under PLAYWRIGHT_BROWSERS_PATH that may
 * not match the build @playwright/test expects, and downloading is blocked
 * there. Fall back to whichever chromium build is actually present. Returns
 * undefined elsewhere, so CI keeps using its own installed browser.
 */
function resolveChromiumExecutable(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  return readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .reverse()
    .map((d) => join(root, d, "chrome-linux", "chrome"))
    .find((p) => existsSync(p));
}

const chromiumExecutable = resolveChromiumExecutable();

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
  },
  webServer: {
    command: "npm run dev:e2e",
    url: `${baseURL}${appBasePath}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: e2eEnv,
  },
  projects: [
    { name: "e2e", testDir: "tests/e2e" },
    { name: "a11y", testDir: "tests/a11y" },
    { name: "visual", testDir: "tests/visual" },
    // Full user journeys: money paths, documents, cross-stage flows, tenancy.
    // Generous timeout: the dev server compiles the SPA on first navigation,
    // which alone takes ~25s here, and browser journeys then do real work.
    { name: "journeys", testDir: "tests/journeys", timeout: 120_000 },
  ],
});
