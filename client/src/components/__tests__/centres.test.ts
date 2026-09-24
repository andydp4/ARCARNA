import { describe, expect, it } from "vitest";
import { centreForPath, centreLandingHref, centreTourKeyForPath, centres, navGroupLabelForHref, visibleCentres, visibleTabs, navItems } from "../nav-items";

const keys = (role: string) => visibleCentres(role).map((c) => c.key);
const pageKeys = (role: string, centre: string) =>
  visibleCentres(role).find((c) => c.key === centre)?.items.map((i) => i.key);

describe("Centres (v1.2 Phase 3)", () => {
  it("has the seven Centres in order", () => {
    expect(centres.map((c) => c.label)).toEqual([
      "Control Centre",
      "Operations Centre",
      "Stock Centre",
      "Truths Centre",
      "Customer Centre",
      "Finance Centre",
      "Settings Centre",
    ]);
  });

  it("gives a cashier Control, Operations, Stock (levels only), Finance (Shifts) and Settings", () => {
    expect(keys("CASHIER")).toEqual(["control", "operations", "stock", "finance", "settings"]);
    // My run (drivers) and My performance (v1.2 Phase 7C) are every role's.
    expect(pageKeys("CASHIER", "operations")).toEqual(["orders", "my-run", "my-performance"]);
    expect(pageKeys("CASHIER", "stock")).toEqual(["stock-levels"]);
    expect(pageKeys("CASHIER", "finance")).toEqual(["shifts"]);
    expect(pageKeys("CASHIER", "settings")).toEqual(["settings"]);
    expect(centreLandingHref("stock", "CASHIER")).toBe("/stock-levels");
  });

  it("opens the Stock Centre on Products for a manager, with Suppliers and no Stock levels", () => {
    expect(centreLandingHref("stock", "MANAGER")).toBe("/products");
    expect(pageKeys("MANAGER", "stock")).toEqual(["products", "inventory", "purchase-drafts", "suppliers"]);
  });

  it("puts the Credit List under Operations and Invoices under Finance, for managers only (Q11)", () => {
    expect(pageKeys("MANAGER", "operations")).toContain("tick-list");
    expect(pageKeys("MANAGER", "finance")).toEqual(["shifts", "expenses", "reseller-partners", "cashier-payroll", "staff-performance-finance", "invoices"]);
  });

  it("opens the Truths Centre on Truths at a glance for managers and above", () => {
    expect(centreLandingHref("truths", "MANAGER")).toBe("/truths");
    expect(pageKeys("MANAGER", "truths")?.[0]).toBe("truths-at-a-glance");
    expect(centreForPath("/truths")?.key).toBe("truths");
    expect(keys("CASHIER")).not.toContain("truths");
  });

  it("keeps Profit Truths to admins", () => {
    expect(pageKeys("MANAGER", "truths")).not.toContain("profit");
    expect(pageKeys("ADMIN", "truths")).toContain("profit");
  });

  it("lists Settings tabs as sub-items, role-filtered, with Suppliers moved out", () => {
    const settings = navItems.find((i) => i.key === "settings")!;
    expect(visibleTabs(settings, "CASHIER").map((t) => t.tab)).toEqual(["general", "payment", "invoice", "system", "integrations", "users"]);
    expect(visibleTabs(settings, "ADMIN").map((t) => t.tab)).toContain("flags");
    expect(visibleTabs(settings, "ADMIN").map((t) => t.tab)).not.toContain("suppliers");
    expect(pageKeys("ADMIN", "settings")).toContain("locations");
  });

  it("opens the right Centre from a deep link", () => {
    expect(centreForPath("/")?.key).toBe("control");
    expect(centreForPath("/operations?pane=order")?.key).toBe("operations");
    expect(centreForPath("/open-orders/abc/refund")?.key).toBe("operations");
    expect(centreForPath("/reports/daily-sales")?.key).toBe("truths");
    expect(centreForPath("/analytics/rfm")?.key).toBe("truths");
    expect(centreForPath("/promotions/p1/lift")?.key).toBe("customer");
    expect(centreForPath("/settings/developer")?.key).toBe("settings");
    expect(centreForPath("/settings/receipts")?.key).toBe("settings");
    expect(centreForPath("/suppliers")?.key).toBe("stock");
    expect(centreForPath("/nowhere")).toBeUndefined();
  });

  it("gives page eyebrows the Centre name", () => {
    expect(navGroupLabelForHref("/products")).toBe("Stock Centre");
    expect(navGroupLabelForHref("/shifts")).toBe("Finance Centre");
  });
});

describe("which Centre tour a viewer gets", () => {
  it("tours the Centre of a page the viewer may open", () => {
    expect(centreTourKeyForPath("/products", "MANAGER")).toBe("stock");
    expect(centreTourKeyForPath("/stock-levels", "CASHIER")).toBe("stock");
    expect(centreTourKeyForPath("/shifts", "CASHIER")).toBe("finance");
    expect(centreTourKeyForPath("/truths", "MANAGER")).toBe("truths");
    expect(centreTourKeyForPath("/reports/daily-sales", "MANAGER")).toBe("truths");
  });

  it("never tours a Centre, or a page, the viewer cannot open", () => {
    // An old /insights bookmark lands a cashier on /truths: no access, no tour.
    expect(centreTourKeyForPath("/truths", "CASHIER")).toBeUndefined();
    expect(centreTourKeyForPath("/reports/daily-sales", "CASHIER")).toBeUndefined();
    // The Stock Centre is visible to a cashier (Stock levels) but Products is not theirs.
    expect(centreTourKeyForPath("/products", "CASHIER")).toBeUndefined();
    expect(centreTourKeyForPath("/not-a-centre-page", "ADMIN")).toBeUndefined();
  });
});
