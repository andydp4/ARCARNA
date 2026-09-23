import { describe, expect, it } from "vitest";
import { centreForPath, centreLandingHref, centres, navGroupLabelForHref, visibleCentres, visibleTabs, navItems } from "../nav-items";

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
    expect(pageKeys("CASHIER", "operations")).toEqual(["orders"]);
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
    expect(pageKeys("MANAGER", "finance")).toEqual(["shifts", "expenses", "reseller-partners", "cashier-payroll", "invoices"]);
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
