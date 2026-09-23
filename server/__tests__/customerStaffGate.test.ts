/**
 * Shop accounts (CUSTOMER) belong to an org, so they used to pass the org-scope
 * check every staff route sits behind — and could read the customer list, the
 * credit list, invoices and the board through the API, kept out only by a
 * browser redirect. requireOrgScope now refuses them; the shop's own routes
 * use requireCustomerOrgScope.
 */
import { describe, it, expect, vi } from "vitest";

// commonAuth imports the db and storage at load; these checks never touch them.
vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ storage: {} }));

const { requireCustomerOrgScope, requireOrgScope } = await import("../auth/commonAuth");

function run(mw: typeof requireOrgScope, orgContext: unknown) {
  const req = { orgContext } as never;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const next = vi.fn();
  return Promise.resolve(mw(req, res as never, next)).then(() => ({ res, next }));
}

describe("staff routes refuse shop accounts", () => {
  it("refuses a CUSTOMER on staff routes, even with an org", async () => {
    const { res, next } = await run(requireOrgScope, { orgId: "org-1", role: "CUSTOMER" });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: "STAFF_ONLY" });
  });

  it("still lets every staff role through", async () => {
    for (const role of ["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"]) {
      const { next } = await run(requireOrgScope, { orgId: "org-1", role });
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it("lets a CUSTOMER use the shop's own routes", async () => {
    const { next } = await run(requireCustomerOrgScope, { orgId: "org-1", role: "CUSTOMER" });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("still requires an org on both", async () => {
    for (const mw of [requireOrgScope, requireCustomerOrgScope]) {
      const { res, next } = await run(mw, { orgId: null, role: "CASHIER" });
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    }
  });
});
