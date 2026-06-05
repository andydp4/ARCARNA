import { describe, expect, it } from "vitest";
import { parseCsv, parseSpreadsheet } from "../../server/import/spreadsheet";

describe("parseCsv", () => {
  it("parses headers and rows", () => {
    const sheet = parseCsv("sku,name\nABC,Widget\nDEF,Gadget");
    expect(sheet.headers).toEqual(["sku", "name"]);
    expect(sheet.rows).toEqual([
      { sku: "ABC", name: "Widget" },
      { sku: "DEF", name: "Gadget" },
    ]);
  });
});

describe("parseSpreadsheet", () => {
  it("rejects oversize uploads", async () => {
    const huge = Buffer.alloc(33 * 1024 * 1024, 1).toString("base64");
    await expect(parseSpreadsheet(huge, "products.csv")).rejects.toThrow(/exceeds/i);
  });

  it("rejects unsupported extensions", async () => {
    const content = Buffer.from("test").toString("base64");
    await expect(parseSpreadsheet(content, "products.exe")).rejects.toThrow(/Unsupported file type/i);
  });
});
