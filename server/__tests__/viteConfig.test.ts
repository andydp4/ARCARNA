import { afterEach, describe, expect, it } from "vitest";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import viteConfig, { normalizeViteBase } from "../../vite.config";

const createdEnvFiles: string[] = [];

afterEach(() => {
  while (createdEnvFiles.length) {
    const file = createdEnvFiles.pop()!;
    if (existsSync(file)) unlinkSync(file);
  }
});

function writeModeEnv(mode: string, content: string): void {
  const file = resolve(process.cwd(), `.env.${mode}`);
  writeFileSync(file, content);
  createdEnvFiles.push(file);
}

describe("vite config base path", () => {
  it("normalizes VITE_BASE_PATH values for Vite asset URLs", () => {
    expect(normalizeViteBase(undefined)).toBe("/");
    expect(normalizeViteBase("/")).toBe("/");
    expect(normalizeViteBase("/arcarna")).toBe("/arcarna/");
    expect(normalizeViteBase("/arcarna/")).toBe("/arcarna/");
  });

  it("loads repo-root .env values when calculating the Vite asset base", () => {
    const mode = `base-test-${process.pid}`;
    writeModeEnv(mode, "VITE_BASE_PATH=/arcarna\n");

    const config =
      typeof viteConfig === "function"
        ? viteConfig({ mode, command: "build", isSsrBuild: false, isPreview: false })
        : viteConfig;

    expect(config).toMatchObject({ base: "/arcarna/" });
  });
});
