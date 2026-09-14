import { describe, expect, it } from "vitest";
import { navGroups, navItems, rolesForHref } from "../nav-items";

/**
 * Role-visibility redesign (ARC-007/008/009): nav-items.ts is the single
 * source of truth `RequireRole` (App.tsx route gating) reads from via
 * `rolesForHref`, so these are really testing the shape of the whole app's
 * default role menu, not just the sidebar.
 */

function itemByKey(key: string) {
  const item = navItems.find((i) => i.key === key);
  if (!item) throw new Error(`No nav item with key "${key}"`);
  return item;
}

describe("nav-items role visibility", () => {
  it("keeps Control Centre, Sell, and Settings open to every role", () => {
    for (const key of ["home", "pos", "orders", "shifts", "invoices", "tick-list", "settings"]) {
      expect(itemByKey(key).roles, `${key} should have no role restriction`).toBeUndefined();
    }
  });

  it("hides Stock, Understand, and (non-Settings) Operate/Administer items from CASHIER", () => {
    const hiddenFromCashierGroups = ["stock", "understand", "operate", "administer"];
    for (const groupKey of hiddenFromCashierGroups) {
      const group = navGroups.find((g) => g.key === groupKey)!;
      for (const item of group.items) {
        if (item.key === "settings") continue; // deliberately open to all roles
        expect(
          item.roles?.includes("CASHIER"),
          `${item.key} should not list CASHIER in its roles`,
        ).not.toBe(true);
      }
    }
  });

  it("gives MANAGER the Stock group and most of Operate, but not Profit Truths", () => {
    for (const key of ["products", "inventory", "purchase-drafts", "customers", "loyalty", "promotions", "gift-cards", "expenses", "reseller-partners", "cashier-payroll"]) {
      expect(itemByKey(key).roles, `${key} should include MANAGER`).toContain("MANAGER");
    }
    expect(itemByKey("profit").roles, "profit (whole-business P&L) should exclude MANAGER").not.toContain("MANAGER");
  });

  it("fixes the known-wrong admin-nav cases (ARC-007)", () => {
    expect(itemByKey("developer").roles?.slice().sort()).toEqual(["ADMIN", "SUPER_ADMIN"]);
    expect(itemByKey("audit-logs").roles).toEqual(["SUPER_ADMIN"]);
    expect(itemByKey("worker-logs").roles).toEqual(["SUPER_ADMIN"]);
    expect(itemByKey("rules").roles).toContain("MANAGER");
  });

  it("keeps Locations admin-only, matching its all-CRUD-is-ADMIN+ server routes", () => {
    expect(itemByKey("locations").roles?.slice().sort()).toEqual(["ADMIN", "SUPER_ADMIN"]);
  });
});

describe("rolesForHref", () => {
  it("returns a nav item's own roles for its href", () => {
    expect(rolesForHref("/products")).toEqual(itemByKey("products").roles);
    expect(rolesForHref("/audit-logs")).toEqual(["SUPER_ADMIN"]);
  });

  it("returns undefined for an open route", () => {
    expect(rolesForHref("/create-order")).toBeUndefined();
  });

  it("covers routes reached only via a link, not the sidebar, with EXTRA_ROUTE_ROLES", () => {
    expect(rolesForHref("/settings/receipts")).toEqual(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
    expect(rolesForHref("/settings/loyalty")).toEqual(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
  });

  it("returns undefined for a route with no nav item and no extra entry", () => {
    expect(rolesForHref("/not-a-real-route")).toBeUndefined();
  });
});
