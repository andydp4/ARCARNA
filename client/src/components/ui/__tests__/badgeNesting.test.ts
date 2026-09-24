import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge } from "../badge";
import { ProvisionalNote } from "@/pages/reports/staff-performance";
import { ProvisionalToday } from "@/pages/my-performance";

/** Block-level tags that are invalid inside a <p> (React's validateDOMNesting). */
const BLOCK_IN_P = /<p[\s>](?:(?!<\/p>).)*<(div|section|ul|ol|table|h[1-6])[\s>]/s;

describe("Badge inside running text (v1.2.1 UI-04)", () => {
  it("renders an inline element, not a <div>", () => {
    const html = renderToStaticMarkup(createElement(Badge, null, "Provisional"));
    expect(html.startsWith("<span")).toBe(true);
  });

  it("ProvisionalNote (Staff Performance) has no block element inside its <p>", () => {
    const html = renderToStaticMarkup(createElement(ProvisionalNote, { until: "2026-10-01" }));
    expect(html).toContain("Provisional");
    expect(html).not.toMatch(BLOCK_IN_P);
  });

  it("ProvisionalToday (My performance) has no block element inside its <p>", () => {
    const html = renderToStaticMarkup(createElement(ProvisionalToday));
    expect(html).toContain("Provisional");
    expect(html).not.toMatch(BLOCK_IN_P);
  });
});
