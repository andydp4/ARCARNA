import { describe, expect, it } from "vitest";
import { canAssignRole, isRole, roleRank } from "./rbac";

describe("rbac roles", () => {
  it("treats CUSTOMER as an approved website-only role below staff", () => {
    expect(isRole("CUSTOMER")).toBe(true);
    expect(roleRank("CUSTOMER")).toBeLessThan(roleRank("CASHIER"));
  });

  it("allows admins to approve customers but not super admins", () => {
    expect(canAssignRole("ADMIN", "CUSTOMER")).toBe(true);
    expect(canAssignRole("ADMIN", "SUPER_ADMIN")).toBe(false);
  });
});
