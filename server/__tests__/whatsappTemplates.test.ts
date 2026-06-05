import { describe, it, expect } from "vitest";
import { mapTemplates } from "../whatsapp/client";
import { SEED_TEMPLATES, extractVariables } from "../whatsapp/templates";

describe("extractVariables", () => {
  it("extracts {{n}} placeholders in order", () => {
    expect(extractVariables("Hi {{1}}, total {{2}}")).toEqual(["{{1}}", "{{2}}"]);
  });
  it("returns empty for no placeholders", () => {
    expect(extractVariables("Thanks for shopping")).toEqual([]);
  });
});

describe("seed templates", () => {
  it("includes the core templates from the brief", () => {
    const names = SEED_TEMPLATES.map((t) => t.templateName);
    expect(names).toContain("order_confirmation");
    expect(names).toContain("order_ready");
    expect(names).toContain("stock_update");
    expect(names).toContain("payment_reminder");
  });
});

describe("mapTemplates (Graph API → flat shape)", () => {
  it("maps the BODY component text and derives variables", () => {
    const json = {
      data: [
        {
          name: "order_confirmation",
          category: "UTILITY",
          language: "en_GB",
          status: "APPROVED",
          components: [
            { type: "BODY", text: "Hi {{1}}, total {{2}}." },
            { type: "FOOTER", text: "Thanks" },
          ],
        },
      ],
    };
    const mapped = mapTemplates(json);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      name: "order_confirmation",
      category: "UTILITY",
      language: "en_GB",
      status: "APPROVED",
      body: "Hi {{1}}, total {{2}}.",
    });
    expect(mapped[0].variables).toEqual(["{{1}}", "{{2}}"]);
  });

  it("tolerates missing data/components", () => {
    expect(mapTemplates({})).toEqual([]);
    expect(mapTemplates({ data: [{ name: "x", components: [] }] })[0].body).toBe("");
  });
});
