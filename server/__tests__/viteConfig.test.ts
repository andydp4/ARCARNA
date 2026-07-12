import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadBuildEnv, normalizeViteBasePath } from "../../vite.config";

const originalViteBasePath = process.env.VITE_BASE_PATH;

afterEach(() => {
  if (originalViteBasePath === undefined) {
    delete process.env.VITE_BASE_PATH;
  } else {
    process.env.VITE_BASE_PATH = originalViteBasePath;
  }
});

describe("Vite base path config", () => {
  it("normalizes empty, root, and path-mounted base paths", () => {
    expect(normalizeViteBasePath(undefined)).toBe("/");
    expect(normalizeViteBasePath("/")).toBe("/");
    expect(normalizeViteBasePath("/arcarna")).toBe("/arcarna/");
    expect(normalizeViteBasePath("/arcarna/")).toBe("/arcarna/");
  });

  it("loads VITE_BASE_PATH from envDir so asset base matches the client bundle", () => {
    delete process.env.VITE_BASE_PATH;
    const envDir = mkdtempSync(path.join(tmpdir(), "arcarna-vite-env-"));
    try {
      writeFileSync(path.join(envDir, ".env"), "VITE_BASE_PATH=/arcarna\n");

      const env = loadBuildEnv("production", envDir);

      expect(normalizeViteBasePath(process.env.VITE_BASE_PATH || env.VITE_BASE_PATH)).toBe("/arcarna/");
    } finally {
      rmSync(envDir, { recursive: true, force: true });
    }
  });
});
