import type { RequestHandler } from "express";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `GET /api/locations` is the list the POS "Open shift" modal reads before a
 * shift can be opened (client/src/pages/pos/shift-open.tsx). It used to be
 * gated to SUPER_ADMIN/ADMIN, which left every MANAGER/CASHIER staring at an
 * empty location picker and locked out of the till. It is now readable by all
 * org roles — but only admins may see the per-location revenue stats.
 */

const getLocationsMock = vi.hoisted(() => vi.fn());
const getLocationPickerOptionsMock = vi.hoisted(() => vi.fn());
const requireRoleCalls = vi.hoisted(() => [] as string[][]);

vi.mock("../storage", () => ({
  storage: {
    getLocations: getLocationsMock,
    getLocationPickerOptions: getLocationPickerOptionsMock,
  },
}));

vi.mock("../auth", () => ({
  isAuthenticated: ((_req, _res, next) => next()) as RequestHandler,
  isOwner: ((_req, _res, next) => next()) as RequestHandler,
  requireOrgContext: ((_req, _res, next) => next()) as RequestHandler,
  requireOrgScope: ((_req, _res, next) => next()) as RequestHandler,
  requireSuperAdminMfa: ((_req, _res, next) => next()) as RequestHandler,
  requireRole: (...roles: string[]) => {
    requireRoleCalls.push(roles);
    return ((_req, _res, next) => next()) as RequestHandler;
  },
}));

vi.mock("../adminAudit", () => ({ recordAdminAudit: vi.fn().mockResolvedValue(undefined) }));

const { registerLocationRoutes } = await import("../routes/locations");

const ORG_ID = "00000000-0000-4000-8000-000000000001";

/** Registers the routes against a stub app and returns the GET /api/locations handler. */
function getLocationsHandler() {
  requireRoleCalls.length = 0;
  let handler: RequestHandler | undefined;
  let guardRoles: string[] = [];
  const app = {
    get: (path: string, ...handlers: RequestHandler[]) => {
      if (path === "/api/locations") {
        handler = handlers[handlers.length - 1];
        guardRoles = requireRoleCalls[requireRoleCalls.length - 1] ?? [];
      }
    },
    post: () => {},
    patch: () => {},
    delete: () => {},
  };
  registerLocationRoutes(app as never, []);
  if (!handler) throw new Error("GET /api/locations was not registered");
  return { handler, guardRoles };
}

async function callAs(role: string) {
  const { handler } = getLocationsHandler();
  const json = vi.fn();
  const res = { json, status: vi.fn().mockReturnThis() };
  await handler({ orgContext: { orgId: ORG_ID, locationId: null, role } } as never, res as never, vi.fn());
  return { json, res };
}

describe("GET /api/locations", () => {
  beforeEach(() => {
    getLocationsMock.mockReset().mockResolvedValue([{ id: "loc-1", name: "Main", stats: { totalRevenue: 4200 } }]);
    getLocationPickerOptionsMock
      .mockReset()
      .mockResolvedValue([{ id: "loc-1", name: "Main", isActive: 1, isDefault: 1 }]);
  });

  it("is reachable by every org role, so POS staff can pick a location", () => {
    const { guardRoles } = getLocationsHandler();
    expect(guardRoles.sort()).toEqual(["ADMIN", "CASHIER", "MANAGER", "SUPER_ADMIN"]);
  });

  it.each(["CASHIER", "MANAGER"])("returns the stats-free picker list to a %s", async (role) => {
    const { json } = await callAs(role);
    expect(getLocationPickerOptionsMock).toHaveBeenCalledWith(ORG_ID);
    expect(getLocationsMock).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith([{ id: "loc-1", name: "Main", isActive: 1, isDefault: 1 }]);
  });

  it.each(["ADMIN", "SUPER_ADMIN"])("still returns the full payload with stats to a %s", async (role) => {
    const { json } = await callAs(role);
    expect(getLocationsMock).toHaveBeenCalledWith(ORG_ID);
    expect(getLocationPickerOptionsMock).not.toHaveBeenCalled();
    expect(json.mock.calls[0][0][0]).toHaveProperty("stats");
  });
});
