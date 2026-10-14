import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildZReport } from "@shared/reports/zReport";
import { ZReportView } from "../ZReport";

const shift = {
  id: "drawer", openingFloat: 50, closingCount: 50, expectedCash: 60,
  variance: -10, openedAt: "2026-10-11T09:00:00Z", closedAt: "2026-10-11T17:00:00Z",
  cashierName: "Alex", locationName: "Counter", status: "closed",
};

describe("Z-report reconciliation warning", () => {
  it("prints the unassigned cash warning alongside the unchanged drawer balance", () => {
    const report = buildZReport(shift, [], []);
    report.unattachedCashRefunds = { count: 2, cashTotal: 16.67 };
    const html = renderToStaticMarkup(createElement(ZReportView, { report }));
    expect(html).toContain('data-testid="z-unattached-refunds"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("£16.67");
    expect(html).toContain("not included in this drawer");
    expect(html).toContain("organisation-wide exception total");
    expect(html).toContain("£60.00");
    expect(html).toContain("£-10.00");
  });

  it("does not show a missing-cash warning for a report with no exceptions", () => {
    const report = buildZReport(shift, [], []);
    report.unattachedCashRefunds = { count: 0, cashTotal: 0 };
    expect(renderToStaticMarkup(createElement(ZReportView, { report }))).not.toContain('data-testid="z-unattached-refunds"');
  });
});
