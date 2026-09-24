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
    } else if (/\.tsx$/.test(name)) {
      out.push({ file: path.relative(CLIENT_SRC, full), text: readFileSync(full, "utf8") });
    }
  }
  return out;
}

/**
 * v1.2.1 UI-15: the house style is a lowercase "arcarna", in every sentence
 * and label ("arcarna Voice", "How is arcarna set up…"). A capitalised
 * "Arcarna" as a whole word in a component's copy (not an identifier such as
 * ArcarnaAssistantBar, and not a code comment) is a slip.
 */
describe("brand copy says arcarna, lowercase", () => {
  it("has no capitalised Arcarna in user-facing copy", () => {
    const offenders: string[] = [];
    for (const { file, text } of sources()) {
      text.split("\n").forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*")) return;
        if (/\bArcarna\b(?![A-Za-z])/.test(line.replace(/\/\/.*$/, ""))) offenders.push(`${file}:${i + 1}: ${t}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
