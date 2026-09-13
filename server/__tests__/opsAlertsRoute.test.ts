/**
 * `/api/operations/alerts/*` — acknowledgement (Phase N, N5a;
 * server/routes/opsAlerts.ts). No database: `../db` is a fake whose
 * `select`/`update` chains resolve to whatever this test pre-loaded, the same
 * technique `opsSettings.test.ts` and `opsStationRoute.test.ts` already use —
 * real `@shared/schema` table objects and `drizzle-orm` query builders run for
 * real (they touch no I/O), only the pool at the end of the chain is fake.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestHandler } from "express";

const state = vi.hoisted(() => ({
  /** What `select().from(opsAlerts).where(...).limit(1)` resolves to next. */
  selectResult: [] as Array<{ id: string; ackedAt: Date | null }>,
  /** What `update(opsAlerts).set(...).where(...).returning(...)` resolves to next. */
  updateResult: [] as Array<{ id: string }>,
  /** Every `.set(...)` payload handed to `update`, in call order. */
  updateSets: [] as Array<Record<string, unknown>>,
}));

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.selectResult),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.updateSets.push(values);
        return { where: () => ({ returning: () => Promise.resolve(state.updateResult) }) };
      },
    }),
  },
}));

const { registerOpsAlertRoutes } = await import("../routes/opsAlerts");

type RouteMap = Record<string, RequestHandler[]>;

function captureRoutes(register: (app: any, scoped: RequestHandler[]) => void): RouteMap {
  const routes: RouteMap = {};
  const app = {
    get: (path: string, ...handlers: RequestHandler[]) => (routes[`GET ${path}`] = handlers),
    post: (path: string, ...handlers: RequestHandler[]) => (routes[`POST ${path}`] = handlers),
    patch: (path: string, ...handlers: RequestHandler[]) => (routes[`PATCH ${path}`] = handlers),
  };
  register(app, []);
  return routes;
}

function fakeRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json } as any;
}

const routes = captureRoutes(registerOpsAlertRoutes);

beforeEach(() => {
  state.selectResult = [];
  state.updateResult = [];
  state.updateSets = [];
});

describe("PATCH /api/operations/alerts/:id/ack", () => {
  it("400s with no org context", async () => {
    const [handler] = routes["PATCH /api/operations/alerts/:id/ack"];
    const req = { orgContext: { orgId: null }, user: { id: "sam" }, params: { id: "a1" } } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("401s with no signed-in actor", async () => {
    const [handler] = routes["PATCH /api/operations/alerts/:id/ack"];
    const req = { orgContext: { orgId: "org-1" }, user: undefined, params: { id: "a1" } } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("404s when no row matches (wrong org, wrong owner, or missing)", async () => {
    state.selectResult = [];
    const [handler] = routes["PATCH /api/operations/alerts/:id/ack"];
    const req = { orgContext: { orgId: "org-1" }, user: { id: "sam" }, params: { id: "a1" } } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(state.updateSets).toHaveLength(0);
  });

  it("acks an own, unacked row and reports changed:true", async () => {
    state.selectResult = [{ id: "a1", ackedAt: null }];
    state.updateResult = [{ id: "a1" }];
    const [handler] = routes["PATCH /api/operations/alerts/:id/ack"];
    const req = { orgContext: { orgId: "org-1" }, user: { id: "sam" }, params: { id: "a1" } } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(state.updateSets).toHaveLength(1);
    expect(state.updateSets[0]).toMatchObject({ ackedByUserId: "sam" });
    expect(state.updateSets[0].ackedAt).toBeInstanceOf(Date);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: "a1", changed: true }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it("a repeat ack is idempotent: changed:false, no second write", async () => {
    const already = new Date("2026-09-12T14:05:00.000Z");
    state.selectResult = [{ id: "a1", ackedAt: already }];
    const [handler] = routes["PATCH /api/operations/alerts/:id/ack"];
    const req = { orgContext: { orgId: "org-1" }, user: { id: "sam" }, params: { id: "a1" } } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(state.updateSets).toHaveLength(0);
    expect(res.json).toHaveBeenCalledWith({ id: "a1", ackedAt: already.toISOString(), changed: false });
  });
});

describe("POST /api/operations/alerts/ack-all", () => {
  it("400s with no org context", async () => {
    const [handler] = routes["POST /api/operations/alerts/ack-all"];
    const req = { orgContext: { orgId: null }, user: { id: "sam" } } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("401s with no signed-in actor", async () => {
    const [handler] = routes["POST /api/operations/alerts/ack-all"];
    const req = { orgContext: { orgId: "org-1" }, user: undefined } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("acks every open row and reports the count", async () => {
    state.updateResult = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];
    const [handler] = routes["POST /api/operations/alerts/ack-all"];
    const req = { orgContext: { orgId: "org-1" }, user: { id: "sam" } } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(state.updateSets[0]).toMatchObject({ ackedByUserId: "sam" });
    expect(res.json).toHaveBeenCalledWith({ acked: 3 });
  });

  it("zero open rows is a clean 0, not an error", async () => {
    state.updateResult = [];
    const [handler] = routes["POST /api/operations/alerts/ack-all"];
    const req = { orgContext: { orgId: "org-1" }, user: { id: "sam" } } as any;
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith({ acked: 0 });
    expect(res.status).not.toHaveBeenCalled();
  });
});
