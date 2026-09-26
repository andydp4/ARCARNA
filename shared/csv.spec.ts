import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, csvDocument, csvFromRecords, csvRow } from "./csv";

describe("csvCell (PRV-02, FIX-14: exports must not carry live formulas)", () => {
  it("neutralises cells a spreadsheet would run as a formula", () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell("+44 7700")).toBe(`"'+44 7700"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("-cmd")).toBe(`"'-cmd"`);
    expect(csvCell("\t=1+1")).toBe(`"'\t=1+1"`);
  });

  it("leaves numbers, including negative ones, as numbers", () => {
    expect(csvCell(-5)).toBe('"-5"');
    expect(csvCell("-12.50")).toBe('"-12.50"');
    expect(csvCell("13.37")).toBe('"13.37"');
  });

  it("quotes every cell, doubles quotes and blanks null", () => {
    expect(csvCell("Smith, Jo")).toBe('"Smith, Jo"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe('""');
    expect(csvRow(["a", 1, null])).toBe('"a","1",""');
  });
});

describe("csvDocument", () => {
  it("starts with the UTF-8 marker and ends every row with CRLF", () => {
    const doc = csvDocument(["Name", "Owed"], [["Zoë", "£5.00"]]);
    expect(doc.startsWith(CSV_BOM)).toBe(true);
    expect(doc).toBe(`${CSV_BOM}"Name","Owed"\r\n"Zoë","£5.00"\r\n`);
  });

  it('a customer named "=HYPERLINK(…)" exports as plain text (owner check 6)', () => {
    const doc = csvFromRecords([{ name: '=HYPERLINK("http://evil","Click")', points: 10 }]);
    expect(doc).toContain(`"'=HYPERLINK(""http://evil"",""Click"")"`);
    expect(doc).not.toMatch(/(^|,|\n|")=HYPERLINK/);
  });
});

/**
 * Every file that sends or saves a CSV uses the shared writer: a source file
 * that mentions a text/csv type must import @shared/csv. The few that mention
 * it without writing one are listed with the reason.
 */
describe("every exporter uses the shared writer", () => {
  const root = path.resolve(__dirname, "..");
  const NOT_WRITERS = new Set([
    "server/import/spreadsheet.ts", // an upload MIME allow-list
    "client/src/lib/fileImport.ts", // downloadBlob's default MIME (import templates)
    "client/src/lib/bulkActionsClient.ts", // reads the server's CSV, writes none
  ]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry) && !/\.(spec|test)\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("no hand-built CSV", () => {
    const offenders: string[] = [];
    for (const dir of ["server", "client/src", "shared", "apps/server/src"]) {
      for (const file of walk(path.join(root, dir))) {
        const rel = path.relative(root, file).split(path.sep).join("/");
        if (NOT_WRITERS.has(rel) || rel === "shared/csv.ts") continue;
        const src = readFileSync(file, "utf8");
        if (!/text\/csv/.test(src)) continue;
        // Directly, or through the two wrappers that are built on it.
        if (/["']@shared\/csv["']|\browsToCsv\(|\bgenerateCSVReport\(/.test(src)) continue;
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
