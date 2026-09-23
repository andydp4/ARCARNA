import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "./csv";

describe("csvCell (PRV-02: exports must not carry live formulas)", () => {
  it("neutralises cells a spreadsheet would run as a formula", () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell("+44 7700")).toBe("'+44 7700");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-cmd")).toBe("'-cmd");
  });

  it("leaves numbers, including negative ones, as numbers", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell("13.37")).toBe("13.37");
  });

  it("quotes commas, quotes and newlines, and blanks null", () => {
    expect(csvCell("Smith, Jo")).toBe('"Smith, Jo"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe("");
    expect(csvRow(["a", 1, null])).toBe("a,1,");
  });
});
