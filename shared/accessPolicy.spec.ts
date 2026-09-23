import { describe, expect, it } from "vitest";
import {
  ACCESS_POLICY,
  canSeeCost,
  apiKeyCanReadContact,
  canSeeDeliveryAddress,
  customerEditForRole,
  customerForRole,
  driverCallVerdict,
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
    expect(customerEditForRole({ email: "new@example.com" }, "MANAGER")).toEqual({ email: "new@example.com" });
    expect(customerEditForRole({ phone: "" }, "ADMIN")).toEqual({ phone: "" });
  });

  it("masks for cashiers and managers (Q7): ••0123 and c•••@example.invalid", () => {
    for (const role of ["CASHIER", "MANAGER"]) {
      expect(customerForRole(customer, role)).toMatchObject({
        phoneMasked: "••0123",
        emailMasked: "c•••@example.invalid",
      });
    }
  });

  it("the order summary is a manager's; the merge flag an admin's (PRV-03)", () => {
    const row = { ...customer, totalSpent: "120.00", orderCount: 4, possibleDuplicateOf: "c9", phoneE164: "+447700900123" };
    const cashier = customerForRole(row, "CASHIER") as Record<string, unknown>;
    expect(cashier).not.toHaveProperty("totalSpent");
    expect(cashier).not.toHaveProperty("orderCount");
    expect(cashier).not.toHaveProperty("possibleDuplicateOf");
    expect(cashier).not.toHaveProperty("phoneE164");
    const manager = customerForRole(row, "MANAGER") as Record<string, unknown>;
    expect(manager).toMatchObject({ totalSpent: "120.00", orderCount: 4 });
    expect(manager).not.toHaveProperty("possibleDuplicateOf");
    expect(manager).not.toHaveProperty("phoneE164");
    expect(customerForRole(row, "ADMIN")).toEqual(row);
  });

  it("a view row's SQL-made hints survive the second pass", () => {
    const viewRow = { id: "c1", name: "N", hasPhone: true, hasEmail: false, phoneLast4: "0123", phoneMasked: "••0123", emailMasked: null };
    expect(customerForRole(viewRow, "CASHIER")).toMatchObject({ hasPhone: true, phoneLast4: "0123", phoneMasked: "••0123" });
  });
});

describe("edit without reading (PRV-08)", () => {
  it("points and total spent are typed in by nobody", () => {
    for (const role of ["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"]) {
      const out = customerEditForRole({ name: "N", loyaltyPoints: 9999, totalSpent: "1.00", orgId: "x", id: "y" }, role);
      expect(out, role).toEqual({ name: "N" });
    }
  });

  it("a masked value is never saved, not even by an admin", () => {
    expect(customerEditForRole({ phone: "••0123", email: "c•••@example.invalid" }, "ADMIN")).toEqual({});
  });

  it("each role writes its own set: a manager's phone goes through Replace number", () => {
    expect(customerEditForRole({ phone: "07700 900999", category: "Gold" }, "MANAGER")).toEqual({ category: "Gold" });
    expect(customerEditForRole({ phone: "07700 900999", category: "Gold" }, "CASHIER")).toEqual({ phone: "07700 900999" });
    expect(customerEditForRole({ phone: "07700 900999" }, "ADMIN")).toEqual({ phone: "07700 900999" });
  });

  it("the receipt-email switch is saved as a boolean, and only as one", () => {
    expect(customerEditForRole({ receiptEmailOptIn: false }, "MANAGER")).toEqual({ receiptEmailOptIn: false });
    expect(customerEditForRole({ receiptEmailOptIn: "no" }, "MANAGER")).toEqual({});
  });
});

describe("delivery address and the driver's call (Q8a)", () => {
  const live = { fulfilmentMethod: "delivery", status: "pending" };
  const done = { fulfilmentMethod: "delivery", status: "completed" };

  it("every member of staff sees a live delivery's address; managers and above after completion", () => {
    for (const role of ["CASHIER", "MANAGER", "ADMIN"]) expect(canSeeDeliveryAddress(role, live), role).toBe(true);
    expect(canSeeDeliveryAddress("CASHIER", done)).toBe(false);
    expect(canSeeDeliveryAddress("MANAGER", done)).toBe(true);
    expect(canSeeDeliveryAddress("CUSTOMER", live)).toBe(false);
  });

  it("the phone goes to the assigned driver, out for delivery, until completed; admins always", () => {
    const out = { ...live, status: "out_for_delivery", assignedUserId: "u1", outForDeliveryAt: new Date() };
    expect(driverCallVerdict("CASHIER", "u1", out)).toEqual({ ok: true, via: "assigned-driver" });
    expect(driverCallVerdict("CASHIER", "u2", out).ok).toBe(false);
    expect(driverCallVerdict("MANAGER", "u2", out).ok).toBe(false);
    expect(driverCallVerdict("CASHIER", "u1", { ...out, outForDeliveryAt: null }).ok).toBe(false);
    expect(driverCallVerdict("CASHIER", "u1", { ...out, status: "completed" }).ok).toBe(false);
    expect(driverCallVerdict("CASHIER", "u1", { ...out, fulfilmentMethod: "collection" }).ok).toBe(false);
    expect(driverCallVerdict("ADMIN", "anyone", { ...out, status: "completed", assignedUserId: null })).toEqual({ ok: true, via: "admin" });
  });
});

describe("the customers:read_contact API permission", () => {
  it("is needed for contact details; * has it", () => {
    expect(apiKeyCanReadContact(["customers:read"])).toBe(false);
    expect(apiKeyCanReadContact(["customers:read", "customers:read_contact"])).toBe(true);
    expect(apiKeyCanReadContact(["*"])).toBe(true);
    expect(apiKeyCanReadContact(undefined)).toBe(false);
  });
});
