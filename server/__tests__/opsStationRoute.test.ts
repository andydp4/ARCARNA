/**
 * `/api/operations/*` behaviour (Phase N, N3b; server/routes/operations.ts).
 * `orderTransitionRoles.test.ts` proves the role gate on `/station/:userId`;
 * this file proves what each handler actually does — the self/other station
 * upsert and the `GET /staff` delegation to the board's own staff list.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestHandler } from "express";

const { insertValues, onConflictDoUpdate, dbMock, recordAdminAudit, getOpsBoard } = vi.hoisted(() => {
  const insertValues = vi.fn();
  const onConflictDoUpdate = vi.fn();
  const dbMock = {
    insert: vi.fn(() => ({
      values: (...args: unknown[]) => {
        insertValues(...args);
        return { onConflictDoUpdate };
      },
    })),
  };
  return {
    insertValues,
    onConflictDoUpdate,
    dbMock,
    recordAdminAudit: vi.fn(async () => {}),
    getOpsBoard: vi.fn(),
  };
});
vi.mock("../db", () => ({ db: dbMock }));
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../adminAudit", () => ({ recordAdminAudit }));
vi.mock("../services/opsBoard", () => ({ getOpsBoard }));
import { registerOperationsRoutes } from "../routes/operations";

type RouteMap = Record<string, RequestHandler[]>;

function captureRoutes(register: (app: any, scoped: RequestHandler[]) => void): RouteMap {
  const routes: RouteMap = {};
  const app = {
    get: (path: string, ...handlers: RequestHandler[]) => (routes[`GET ${path}`] = handlers),
    post: (path: string, ...handlers: RequestHandler[]) => (routes[`POST ${path}`] = handlers),
    put: (path: string, ...handlers: RequestHandler[]) => (routes[`PUT ${path}`] = handlers),
    patch: (path: string, ...handlers: RequestHandler[]) => (routes[`PATCH ${path}`] = handlers),
    delete: (path: string, ...handlers: RequestHandler[]) => (routes[`DELETE ${path}`] = handlers),
  };
  register(app, []);
  return routes;
}

function fakeRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json } as any;
}

const routes = captureRoutes(registerOperationsRoutes);

beforeEach(() => {
  insertValues.mockClear();
  onConflictDoUpdate.mockClear().mockResolvedValue(undefined);
  recordAdminAudit.mockClear();
  getOpsBoard.mockReset();
});

describe("GET /api/operations/staff", () => {
  it("returns the board's own staff list and `me` — never a second computation", async () => {
    getOpsBoard.mockResolvedValue({
      staff: [{ userId: "sam", name: "Sam", station: "collection", present: true }],
      me: { userId: "sam", station: "collection", onBreak: false },
    });
    const [handler] = routes["GET /api/operations/staff"];
    const req = { orgContext: { orgId: "org-1" }, user: { id: "sam" } } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(getOpsBoard).toHaveBeenCalledWith("org-1", "sam");
    expect(res.json).toHaveBeenCalledWith({
      staff: [{ userId: "sam", name: "Sam", station: "collection", present: true }],
      me: { userId: "sam", station: "collection", onBreak: false },
    });
  });

  it("400s with no org context", async () => {
    const [handler] = routes["GET /api/operations/staff"];
    const req = { orgContext: { orgId: null } } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("PATCH /api/operations/station (self)", () => {
  it("upserts the actor's own row and stamps stationSetAt", async () => {
    const [handler] = routes["PATCH /api/operations/station"];
    const req = { orgContext: { orgId: "org-1" }, user: { id: "sam" }, body: { station: "collection" } } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "sam", station: "collection" }),
    );
    const inserted = insertValues.mock.calls[0][0];
    expect(inserted.stationSetAt).toBeInstanceOf(Date);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ userId: "sam", station: "collection" });
  });

  it("accepts null to clear the station (reads as All)", async () => {
    const [handler] = routes["PATCH /api/operations/station"];
    const req = { orgContext: { orgId: "org-1" }, user: { id: "sam" }, body: { station: null } } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ station: null }));
  });

  it("400s on an invalid station value", async () => {
    const [handler] = routes["PATCH /api/operations/station"];
    const req = { orgContext: { orgId: "org-1" }, user: { id: "sam" }, body: { station: "kitchen" } } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("401s with no signed-in actor", async () => {
    const [handler] = routes["PATCH /api/operations/station"];
    const req = { orgContext: { orgId: "org-1" }, user: undefined, body: { station: "collection" } } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("sets onBreak independently of station", async () => {
    const [handler] = routes["PATCH /api/operations/station"];
    const req = { orgContext: { orgId: "org-1" }, user: { id: "sam" }, body: { onBreak: true } } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ onBreak: true, station: null }));
  });
});

describe("PATCH /api/operations/station/:userId (MANAGER+)", () => {
  it("upserts the TARGET user's row and records an admin audit entry", async () => {
    const [, handler] = routes["PATCH /api/operations/station/:userId"];
    const req = {
      orgContext: { orgId: "org-1" },
      user: { id: "manager-1", role: "MANAGER" },
      params: { userId: "ana" },
      body: { station: "delivery" },
    } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ userId: "ana", station: "delivery" }));
    expect(recordAdminAudit).toHaveBeenCalledWith(
      req,
      expect.objectContaining({ action: "ops.station_set", targetType: "user", targetId: "ana", orgId: "org-1" }),
    );
    expect(res.json).toHaveBeenCalledWith({ userId: "ana", station: "delivery" });
  });
});
