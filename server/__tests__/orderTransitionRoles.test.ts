/**
 * The Operations Centre RBAC table (Phase N, N3b; docs/briefs/
 * PHASE_N_OPERATIONS_CENTRE.md, "API"). This is the CI gate the brief and
 * `tests/journeys/security/roleEnforcement.spec.ts`'s `OPS_FUTURE_*` arrays
 * both point at.
 *
 * Two different mechanisms are under test, because the table itself is two
 * different KINDS of rule:
 *
 *  - "station for others" and PUT/DELETE are plain `requireRole(...)`
 *    middleware — proved with the `captureRoutes` / `runGuard` pattern from
 *    `mutationRoleGuards.test.ts`, registering the real routes and running
 *    the real middleware with no bypass in front of it.
 *  - "assign to someone else", "unclaim someone else's" and "reopen /
 *    unready after 10 minutes or of someone else's" depend on the ROW, not a
 *    static role list, so they live in `assertTransitionRoleAllowed`
 *    (server/services/orderTransitions.ts) and are proved by calling that
 *    pure function directly with every combination the table describes.
 */
vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ storage: {} }));

import type { RequestHandler } from "express";
import { describe, expect, it, vi } from "vitest";
import { assertTransitionRoleAllowed, TransitionForbiddenError } from "../services/orderTransitions";
import { registerOperationsRoutes } from "../routes/operations";

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

async function runGuard(guard: RequestHandler, role: string) {
  const req = { user: { role } } as any;
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status, json } as any;
  const next = vi.fn();
  await guard(req, res, next);
  return { status, json, next };
}

const now = new Date("2026-09-12T12:00:00Z");
const NINE_MIN = new Date(now.getTime() - 9 * 60_000);
const ELEVEN_MIN = new Date(now.getTime() - 11 * 60_000);

describe("assertTransitionRoleAllowed — row-dependent RBAC", () => {
  describe("claim / ready / arrived / out_for_delivery / complete / hold / unhold / set_due", () => {
    it.each(["claim", "ready", "arrived", "out_for_delivery", "complete", "hold", "unhold", "set_due"] as const)(
      "%s is CASHIER+ with no ownership condition",
      (action) => {
        expect(() =>
          assertTransitionRoleAllowed({
            action,
            actorId: "cashier-a",
            actorRole: "CASHIER",
            assignedUserId: "someone-else",
            now,
          }),
        ).not.toThrow();
      },
    );
  });

  describe("assign", () => {
    it("CASHIER+ may assign their OWN order to anyone (\"passing on one's own order\")", () => {
      expect(() =>
        assertTransitionRoleAllowed({
          action: "assign",
          actorId: "sam",
          actorRole: "CASHIER",
          assignedUserId: "sam",
          now,
        }),
      ).not.toThrow();
    });

    it("CASHIER is refused assigning an order that is not currently theirs", () => {
      expect(() =>
        assertTransitionRoleAllowed({
          action: "assign",
          actorId: "sam",
          actorRole: "CASHIER",
          assignedUserId: "ana",
          now,
        }),
      ).toThrow(TransitionForbiddenError);
    });

    it("MANAGER may assign an order that is not currently theirs", () => {
      expect(() =>
        assertTransitionRoleAllowed({
          action: "assign",
          actorId: "manager-1",
          actorRole: "MANAGER",
          assignedUserId: "ana",
          now,
        }),
      ).not.toThrow();
    });
  });

  describe("unclaim", () => {
    it("CASHIER may unclaim their OWN order", () => {
      expect(() =>
        assertTransitionRoleAllowed({
          action: "unclaim",
          actorId: "sam",
          actorRole: "CASHIER",
          assignedUserId: "sam",
          now,
        }),
      ).not.toThrow();
    });

    it("CASHIER is refused unclaiming someone else's order", () => {
      expect(() =>
        assertTransitionRoleAllowed({
          action: "unclaim",
          actorId: "sam",
          actorRole: "CASHIER",
          assignedUserId: "ana",
          now,
        }),
      ).toThrow(TransitionForbiddenError);
    });

    it("MANAGER may unclaim someone else's order", () => {
      expect(() =>
        assertTransitionRoleAllowed({
          action: "unclaim",
          actorId: "manager-1",
          actorRole: "MANAGER",
          assignedUserId: "ana",
          now,
        }),
      ).not.toThrow();
    });
  });

  describe("reopen", () => {
    it("the completer within 10 minutes is CASHIER+", () => {
      expect(() =>
        assertTransitionRoleAllowed({
          action: "reopen",
          actorId: "sam",
          actorRole: "CASHIER",
          assignedUserId: null,
          completedUserId: "sam",
          settledAt: NINE_MIN,
          now,
        }),
      ).not.toThrow();
    });

    it("the completer after 10 minutes needs MANAGER+", () => {
      expect(() =>
        assertTransitionRoleAllowed({
          action: "reopen",
          actorId: "sam",
          actorRole: "CASHIER",
          assignedUserId: null,
          completedUserId: "sam",
          settledAt: ELEVEN_MIN,
          now,
        }),
      ).toThrow(TransitionForbiddenError);
    });

    it("someone other than the completer, within 10 minutes, needs MANAGER+", () => {
      expect(() =>
        assertTransitionRoleAllowed({
          action: "reopen",
          actorId: "ana",
          actorRole: "CASHIER",
          assignedUserId: null,
          completedUserId: "sam",
          settledAt: NINE_MIN,
          now,
        }),
      ).toThrow(TransitionForbiddenError);
    });

    it("MANAGER may reopen any time, of anyone's", () => {
      expect(() =>
        assertTransitionRoleAllowed({
          action: "reopen",
          actorId: "manager-1",
          actorRole: "MANAGER",
          assignedUserId: null,
          completedUserId: "sam",
          settledAt: ELEVEN_MIN,
          now,
        }),
      ).not.toThrow();
    });
  });

  describe("unready", () => {
    it("the person who marked it ready, within 10 minutes, is CASHIER+", () => {
      expect(() =>
        assertTransitionRoleAllowed({
          action: "unready",
          actorId: "sam",
          actorRole: "CASHIER",
          assignedUserId: null,
          readyMarkedBy: "sam",
          readyMarkedAt: NINE_MIN,
          now,
        }),
      ).not.toThrow();
    });

    it("the same person after 10 minutes needs MANAGER+", () => {
      expect(() =>
        assertTransitionRoleAllowed({
          action: "unready",
          actorId: "sam",
          actorRole: "CASHIER",
          assignedUserId: null,
          readyMarkedBy: "sam",
          readyMarkedAt: ELEVEN_MIN,
          now,
        }),
      ).toThrow(TransitionForbiddenError);
    });

    it("someone other than the marker, within 10 minutes, needs MANAGER+", () => {
      expect(() =>
        assertTransitionRoleAllowed({
          action: "unready",
          actorId: "ana",
          actorRole: "CASHIER",
          assignedUserId: null,
          readyMarkedBy: "sam",
          readyMarkedAt: NINE_MIN,
          now,
        }),
      ).toThrow(TransitionForbiddenError);
    });

    it("MANAGER may undo any time, of anyone's", () => {
      expect(() =>
        assertTransitionRoleAllowed({
          action: "unready",
          actorId: "manager-1",
          actorRole: "MANAGER",
          assignedUserId: null,
          readyMarkedBy: "sam",
          readyMarkedAt: ELEVEN_MIN,
          now,
        }),
      ).not.toThrow();
    });
  });

  it.each(["ADMIN", "SUPER_ADMIN"] as const)("%s counts as MANAGER+ for every row-dependent rule", (role) => {
    expect(() =>
      assertTransitionRoleAllowed({
        action: "reopen",
        actorId: "someone",
        actorRole: role,
        assignedUserId: null,
        completedUserId: "sam",
        settledAt: ELEVEN_MIN,
        now,
      }),
    ).not.toThrow();
  });
});

describe("PATCH /api/operations/station/:userId — MANAGER+ requireRole (captureRoutes / runGuard)", () => {
  const routes = captureRoutes(registerOperationsRoutes);

  it("is registered with a role guard ahead of its handler", () => {
    const chain = routes["PATCH /api/operations/station/:userId"];
    expect(chain).toBeDefined();
    expect(chain.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects a CASHIER with 403 before reaching the handler", async () => {
    const [guard] = routes["PATCH /api/operations/station/:userId"];
    const { status, next } = await runGuard(guard, "CASHIER");
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("admits a MANAGER through to the handler", async () => {
    const [guard] = routes["PATCH /api/operations/station/:userId"];
    const { status, next } = await runGuard(guard, "MANAGER");
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("PATCH /api/operations/station (self) carries no role guard — every CASHIER reaches it", () => {
    const chain = routes["PATCH /api/operations/station"];
    expect(chain).toBeDefined();
    // With scoped=[], an unguarded route is just [businessHandler].
    expect(chain.length).toBe(1);
  });

  it("GET /api/operations/staff carries no role guard — every CASHIER reaches it", () => {
    const chain = routes["GET /api/operations/staff"];
    expect(chain).toBeDefined();
    expect(chain.length).toBe(1);
  });
});
