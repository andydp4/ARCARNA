import { describe, expect, it } from "vitest";
import { getBulkActionsForRole, isBulkActionAllowed } from "./bulkActions";

describe("bulkActions role gating", () => {
  it("allows cashiers export but not delete on customers", () => {
    const actions = getBulkActionsForRole("customers", "CASHIER");
    expect(actions.some((a) => a.id === "export")).toBe(true);
    expect(actions.some((a) => a.id === "delete")).toBe(false);
    expect(isBulkActionAllowed("customers", "delete", "CASHIER")).toBe(false);
  });

  it("allows managers destructive actions", () => {
    expect(isBulkActionAllowed("customers", "delete", "MANAGER")).toBe(true);
    expect(isBulkActionAllowed("products", "delete", "MANAGER")).toBe(true);
  });

  it("orders have no delete action", () => {
    expect(isBulkActionAllowed("orders", "delete", "ADMIN")).toBe(false);
    expect(isBulkActionAllowed("orders", "export", "CASHIER")).toBe(true);
  });
});
