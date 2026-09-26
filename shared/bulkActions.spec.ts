import { describe, expect, it } from "vitest";
import { getBulkActionsForRole, isBulkActionAllowed } from "./bulkActions";

describe("bulkActions role gating", () => {
  it("does not expose staff bulk actions to website customers", () => {
    expect(getBulkActionsForRole("customers", "CUSTOMER")).toEqual([]);
    expect(isBulkActionAllowed("products", "export", "CUSTOMER")).toBe(false);
  });

  it("gives cashiers no customer bulk actions at all", () => {
    expect(getBulkActionsForRole("customers", "CASHIER")).toEqual([]);
    expect(isBulkActionAllowed("customers", "delete", "CASHIER")).toBe(false);
  });

  it("keeps the customer export (contact details) to admins", () => {
    expect(isBulkActionAllowed("customers", "export", "CASHIER")).toBe(false);
    expect(isBulkActionAllowed("customers", "export", "MANAGER")).toBe(false);
    expect(isBulkActionAllowed("customers", "export", "ADMIN")).toBe(true);
    expect(isBulkActionAllowed("customers", "export", "SUPER_ADMIN")).toBe(true);
  });

  it("allows managers destructive actions", () => {
    expect(isBulkActionAllowed("customers", "delete", "MANAGER")).toBe(true);
    expect(isBulkActionAllowed("products", "delete", "MANAGER")).toBe(true);
  });

  it("keeps the product export (cost prices) to admins", () => {
    expect(isBulkActionAllowed("products", "export", "CASHIER")).toBe(false);
    expect(isBulkActionAllowed("products", "export", "MANAGER")).toBe(false);
    expect(isBulkActionAllowed("products", "export", "ADMIN")).toBe(true);
    expect(isBulkActionAllowed("products", "export", "SUPER_ADMIN")).toBe(true);
  });
});
