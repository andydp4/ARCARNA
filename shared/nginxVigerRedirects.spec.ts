import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type RedirectRule =
  | { kind: "exact"; path: string; target: string }
  | { kind: "regex"; pattern: RegExp; target: string };

const config = readFileSync("deploy/nginx-viger.cloud.conf.example", "utf8");

function parseRedirectRules(): RedirectRule[] {
  const rules: RedirectRule[] = [];
  const locationPattern =
    /location\s+(?:(=)\s+(\S+)|(~)\s+(\S+))\s*\{\s*return\s+301\s+([^;]+);\s*\}/g;

  for (const match of config.matchAll(locationPattern)) {
    const [, exactMarker, exactPath, regexMarker, regexPattern, target] = match;
    if (exactMarker) {
      rules.push({ kind: "exact", path: exactPath, target: target.trim() });
    } else if (regexMarker) {
      rules.push({
        kind: "regex",
        pattern: new RegExp(regexPattern),
        target: target.trim(),
      });
    }
  }

  return rules;
}

const redirectRules = parseRedirectRules();

function renderNginxTarget(
  target: string,
  groups: Record<string, string | undefined>,
  args: string,
): string {
  return target.replace(/\$(\w+)/g, (_, name: string) => {
    if (name === "is_args") return args ? "?" : "";
    if (name === "args") return args;
    return groups[name] ?? "";
  });
}

function redirectFor(pathAndQuery: string): string | undefined {
  const queryIndex = pathAndQuery.indexOf("?");
  const requestPath =
    queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
  const args = queryIndex === -1 ? "" : pathAndQuery.slice(queryIndex + 1);

  for (const rule of redirectRules.filter((rule) => rule.kind === "exact")) {
    if (rule.kind === "exact" && rule.path === requestPath) {
      return renderNginxTarget(rule.target, {}, args);
    }
  }

  for (const rule of redirectRules.filter((rule) => rule.kind === "regex")) {
    if (rule.kind !== "regex") continue;
    const match = rule.pattern.exec(requestPath);
    if (match) {
      return renderNginxTarget(rule.target, match.groups ?? {}, args);
    }
  }

  return undefined;
}

describe("viger.cloud legacy nginx redirects", () => {
  it("strips old app base paths while preserving deep links and queries", () => {
    expect(redirectFor("/arcarna/api/health?source=uptime")).toBe(
      "https://arcarna.viger.cloud/api/health?source=uptime",
    );
    expect(redirectFor("/arcarna?next=%2Fpos")).toBe(
      "https://arcarna.viger.cloud/?next=%2Fpos",
    );
    expect(redirectFor("/midnight/pos?register=front")).toBe(
      "https://arcarna.viger.cloud/pos?register=front",
    );
    expect(redirectFor("/midnight")).toBe("https://arcarna.viger.cloud/");
  });

  it("keeps old root app bookmarks from falling through to the static portal", () => {
    expect(redirectFor("/pos?register=front")).toBe(
      "https://arcarna.viger.cloud/pos?register=front",
    );
    expect(redirectFor("/orders")).toBe("https://arcarna.viger.cloud/orders");
    expect(redirectFor("/onboarding/wizard?step=location")).toBe(
      "https://arcarna.viger.cloud/onboarding/wizard?step=location",
    );
  });

  it("leaves standalone portal routes on viger.cloud", () => {
    expect(redirectFor("/files")).toBeUndefined();
    expect(redirectFor("/backups")).toBeUndefined();
  });
});
