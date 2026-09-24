import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLIENT_SRC = path.resolve(__dirname, "../..");

function sources(dir = CLIENT_SRC): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...sources(full));
    } else if (/\.(tsx|ts)$/.test(name)) {
      out.push({ file: path.relative(CLIENT_SRC, full), text: readFileSync(full, "utf8") });
    }
  }
  return out;
}

/**
 * v1.2.1 UI-16: dates were formatted in the browser's locale, so an en-US
 * browser showed Customers' "Last: 9/24/2026". Every toLocale*String call
 * names its locale; the shop is British.
 */
describe("dates and numbers are formatted en-GB, not in the browser's locale", () => {
  it("has no toLocaleString / toLocaleDateString / toLocaleTimeString without a locale", () => {
    const offenders: string[] = [];
    const bare = /\.toLocale(Date|Time)?String\(\s*(\)|undefined\b)/g;
    for (const { file, text } of sources()) {
      text.split("\n").forEach((line, i) => {
        if (bare.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        bare.lastIndex = 0;
      });
    }
    expect(offenders).toEqual([]);
  });

  it("formats the Customers 'Last:' date day-first", () => {
    expect(new Date("2026-09-24T12:00:00Z").toLocaleDateString("en-GB")).toBe("24/09/2026");
  });
});
