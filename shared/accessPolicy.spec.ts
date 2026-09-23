import { describe, expect, it } from "vitest";
import {
  ACCESS_POLICY,
  canSeeCost,
  customerEditForRole,
  customerForRole,
  isAtLeast,
  productForRole,
  productsForRole,
  rolesAtLeast,
} from "./accessPolicy";

describe("access policy helpers", () => {
  it("rolesAtLeast lists staff roles only, lowest first", () => {
    expect(rolesAtLeast("MANAGER")).toEqual(["MANAGER", "ADMIN", "SUPER_ADMIN"]);
    expect(rolesAtLeast("CASHIER")).not.toContain("CUSTOMER");
  });

  it("isAtLeast refuses unknown and missing roles", () => {
    expect(isAtLeast(undefined, "CASHIER")).toBe(false);
    expect(isAtLeast("OWNER", "CASHIER")).toBe(false);
    expect(isAtLeast("CUSTOMER", "CASHIER")).toBe(false);
    expect(isAtLeast("ADMIN", "MANAGER")).toBe(true);
  });

  it("cost is for managers and up, never cashiers or shop accounts", () => {
    expect(canSeeCost("CASHIER")).toBe(false);
    expect(canSeeCost("CUSTOMER")).toBe(false);
    expect(canSeeCost(null)).toBe(false);
    expect(canSeeCost("MANAGER")).toBe(true);
    expect(canSeeCost("SUPER_ADMIN")).toBe(true);
  });

  it("productForRole removes the cost keys for a cashier and leaves the rest", () => {
    const product = { id: "p1", name: "Widget", defaultSalePrice: "20.00", costPrice: "13.37", stock: 2 };
    const seen = productForRole(product, "CASHIER");
    expect(seen).toEqual({ id: "p1", name: "Widget", defaultSalePrice: "20.00", stock: 2 });
    expect("costPrice" in seen).toBe(false);
    // The input is not mutated: the same object may be cached for a manager.
    expect(product.costPrice).toBe("13.37");
    expect(productForRole(product, "MANAGER")).toBe(product);
  });

  it("productsForRole strips every row", () => {
    const rows = [{ costPrice: "1.00", unitCost: 1 }, { costPrice: null, estimatedCost: "2.00" }];
    expect(productsForRole(rows, "CASHIER")).toEqual([{}, {}]);
    expect(productsForRole(rows, "ADMIN")).toBe(rows);
  });

  it("every policy row names a staff role and a reason", () => {
    for (const rule of ACCESS_POLICY) {
      expect(rolesAtLeast(rule.minRole).length, rule.path).toBeGreaterThan(0);
      expect(rule.reason.length, rule.path).toBeGreaterThan(10);
      expect(rule.path.startsWith("/api/"), rule.path).toBe(true);
    }
  });
});

describe("customer contact details (Q13a)", () => {
  const customer = {
    id: "c1",
    name: "Canary Customer",
    phone: "07700 900123",
    email: "canary@example.invalid",
    address: "1 Test Street",
    loyaltyPoints: 5,
  };

  it("below admin: no phone, email or address, only hints", () => {
    for (const role of ["CASHIER", "MANAGER"]) {
      const seen = customerForRole(customer, role) as Record<string, unknown>;
      expect(seen).not.toHaveProperty("phone");
      expect(seen).not.toHaveProperty("email");
      expect(seen).not.toHaveProperty("address");
      expect(seen).toMatchObject({ name: "Canary Customer", loyaltyPoints: 5, hasEmail: true, hasPhone: true, phoneLast4: "0123" });
      expect(JSON.stringify(seen)).not.toContain("7700900123");
    }
    expect(customerForRole({ id: "c2", name: "No contact", phone: null, email: "" }, "CASHIER")).toMatchObject({
      hasEmail: false,
      hasPhone: false,
      phoneLast4: null,
    });
  });

  it("admin and the owner see them", () => {
    expect(customerForRole(customer, "ADMIN")).toEqual(customer);
    expect(customerForRole(customer, "SUPER_ADMIN")).toEqual(customer);
  });

  it("an edit below admin never blanks a contact field it could not see, but saves one typed in", () => {
    expect(customerEditForRole({ name: "N", phone: "", email: null, address: "  " }, "MANAGER")).toEqual({ name: "N" });
    expect(customerEditForRole({ phone: "07700 900999" }, "MANAGER")).toEqual({ phone: "07700 900999" });
    expect(customerEditForRole({ phone: "" }, "ADMIN")).toEqual({ phone: "" });
  });
});
