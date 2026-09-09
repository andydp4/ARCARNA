import type { RequestHandler } from "express";
import { describe, expect, it, vi } from "vitest";

/**
 * ARC-005: customers, loyalty tiers, promotions and overhead expenses were
 * mutable (POST/PUT/PATCH/DELETE) by any authenticated + org-scoped user,
 * including CASHIER — direct API calls bypassed the UI entirely. Each of
 * these routes must now sit behind requireRole("SUPER_ADMIN", "ADMIN",
 * "MANAGER"), the same guard already used by purchase-drafts and
 * tick-customers.
 *
 * This test registers the real routes (with an empty `scoped` array, since
 * org-scoping isn't what's under test) and exercises the real `requireRole`
 * middleware — the one actually wired into the request chain — directly, so
 * a regression here means an unauthenticated attacker's request would truly
 * reach the business handler, not just that a mock recorded the right args.
 */

import { registerCustomerRoutes } from "../routes/customers";
import { registerLoyaltyRoutes } from "../routes/loyalty";
import { registerPromotionRoutes } from "../routes/promotions";
import { registerExpenseRoutes } from "../routes/expenses";

type RouteMap = Record<string, RequestHandler[]>;

function captureRoutes(register: (app: any, scoped: RequestHandler[]) => void): RouteMap {
  const routes: RouteMap = {};
  const app = {
    get: (path: string, ...handlers: RequestHandler[]) => {
      routes[`GET ${path}`] = handlers;
    },
    post: (path: string, ...handlers: RequestHandler[]) => {
      routes[`POST ${path}`] = handlers;
    },
    put: (path: string, ...handlers: RequestHandler[]) => {
      routes[`PUT ${path}`] = handlers;
    },
    patch: (path: string, ...handlers: RequestHandler[]) => {
      routes[`PATCH ${path}`] = handlers;
    },
    delete: (path: string, ...handlers: RequestHandler[]) => {
      routes[`DELETE ${path}`] = handlers;
    },
  };
  register(app, []);
  return routes;
}

/** Builds a fake req/res/next trio and runs one middleware, returning what happened. */
async function runGuard(guard: RequestHandler, role: string) {
  const req = { user: { role } } as any;
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status, json } as any;
  const next = vi.fn();
  await guard(req, res, next);
  return { status, json, next };
}

const customerRoutes = captureRoutes(registerCustomerRoutes);
const loyaltyRoutes = captureRoutes(registerLoyaltyRoutes);
const promotionRoutes = captureRoutes(registerPromotionRoutes);
const expenseRoutes = captureRoutes(registerExpenseRoutes);

/**
 * Each entry is [routeMap, "METHOD /path"]. With `scoped` passed as `[]`,
 * the handler chain for every mutating route here is exactly
 * [mutateRoles-guard, businessHandler] — so index 0 is the guard.
 */
const GUARDED_MUTATIONS: Array<[RouteMap, string]> = [
  [customerRoutes, "POST /api/customers"],
  [customerRoutes, "PUT /api/customers/:id"],
  [customerRoutes, "DELETE /api/customers/:id"],
  [loyaltyRoutes, "POST /api/loyalty-tiers"],
  [loyaltyRoutes, "PATCH /api/loyalty-tiers/:id"],
  [loyaltyRoutes, "DELETE /api/loyalty-tiers/:id"],
  [promotionRoutes, "POST /api/promotions"],
  [promotionRoutes, "PATCH /api/promotions/:id"],
  [promotionRoutes, "DELETE /api/promotions/:id"],
  [expenseRoutes, "POST /api/overhead-expenses"],
  [expenseRoutes, "PUT /api/overhead-expenses/:id"],
  [expenseRoutes, "DELETE /api/overhead-expenses/:id"],
];

describe("ARC-005: customers/loyalty-tiers/promotions/overhead-expenses mutations require MANAGER+", () => {
  it.each(GUARDED_MUTATIONS)("%s is registered with a role guard ahead of its handler", (routes, key) => {
    const chain = routes[key];
    expect(chain, `expected ${key} to be registered`).toBeDefined();
    expect(chain.length).toBeGreaterThanOrEqual(2);
  });

  it.each(GUARDED_MUTATIONS)("%s rejects a CASHIER with 403 before reaching the handler", async (routes, key) => {
    const [guard] = routes[key];
    const { status, json, next } = await runGuard(guard, "CASHIER");
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/access denied/i) }),
    );
  });

  it.each(GUARDED_MUTATIONS)("%s admits a MANAGER through to the handler", async (routes, key) => {
    const [guard] = routes[key];
    const { status, next } = await runGuard(guard, "MANAGER");
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it.each(GUARDED_MUTATIONS)("%s admits an ADMIN and a SUPER_ADMIN through to the handler", async (routes, key) => {
    const [guard] = routes[key];
    for (const role of ["ADMIN", "SUPER_ADMIN"]) {
      const { status, next } = await runGuard(guard, role);
      expect(next).toHaveBeenCalledTimes(1);
      expect(status).not.toHaveBeenCalled();
    }
  });

  it("GET routes on all four files stay open to every authenticated role (no guard inserted)", () => {
    const getOnly = [
      [customerRoutes, "GET /api/customers"],
      [loyaltyRoutes, "GET /api/loyalty-tiers"],
      [promotionRoutes, "GET /api/promotions"],
      [expenseRoutes, "GET /api/overhead-expenses"],
    ] as const;
    for (const [routes, key] of getOnly) {
      const chain = routes[key];
      expect(chain, `expected ${key} to be registered`).toBeDefined();
      // With scoped=[], an unguarded GET is just [businessHandler].
      expect(chain.length).toBe(1);
    }
  });
});
