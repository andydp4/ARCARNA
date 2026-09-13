/**
 * The Operations Centre's org settings, end to end through the four places a
 * setting has to be named before it is real:
 *
 *   1. `orgProfilePatchSchema` (shared/setup.ts)   — else the PATCH is rejected
 *   2. `updateOrgProfile`'s allow-list (storage)   — else it saves NOTHING and
 *                                                    still answers 200
 *   3. the organizations column (shared/schema.ts) — else drizzle drops it
 *   4. `GET /api/settings`'s projection            — else the board cannot read it
 *
 * Step 2 is the one worth a test on its own: the allow-list is an allow-list,
 * so a key added to the zod schema and the Settings card but missed there
 * validates happily, toasts "updated", and changes nothing at all. Nothing
 * else in the stack fails.
 *
 * `GET /api/settings` is also the CASHIER-readable endpoint — `/api/org/setup`
 * is MANAGER+ — and the board is a cashier's screen, so the timing numbers
 * that colour their cards have to come back for them. This runs the whole
 * registered middleware chain for that route as a CASHIER: a `requireRole`
 * added inside `routes/settingsOrg.ts` would 403 here rather than on the floor.
 *
 * No database: `../db` is a fake whose update() records what it was asked to
 * set, so the real storage layer (allow-list included) is exercised for real.
 */
import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "00000000-0000-4000-8000-0000000000aa";

/** The single organizations row this fake database holds. */
const state = vi.hoisted(() => ({
  org: {} as Record<string, unknown>,
  /** What the last `update().set(...)` was handed, before the merge. */
  lastSet: null as Record<string, unknown> | null,
}));

vi.mock("../db", () => {
  /** Awaitable like a drizzle query, and `.limit()`-able for callers that ask. */
  const rows = (values: unknown[]) => {
    const promise: any = Promise.resolve(values);
    promise.limit = () => Promise.resolve(values);
    return promise;
  };
  return {
    db: {
      select: () => ({ from: () => ({ where: () => rows([state.org]) }) }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          state.lastSet = values;
          Object.assign(state.org, values);
          return { where: () => ({ returning: () => rows([state.org]) }) };
        },
      }),
    },
  };
});

const { registerSettingsOrgRoutes } = await import("../routes/settingsOrg");
const { registerSetupAndImportRoutes } = await import("../routes/setupImports");

type RouteMap = Record<string, RequestHandler[]>;

function captureRoutes(register: (app: any) => void): RouteMap {
  const routes: RouteMap = {};
  const record = (method: string) => (path: string, ...handlers: RequestHandler[]) => {
    routes[`${method} ${path}`] = handlers;
  };
  register({
    get: record("GET"),
    post: record("POST"),
    put: record("PUT"),
    patch: record("PATCH"),
    delete: record("DELETE"),
  });
  return routes;
}

/** Sentinel org-scope chain: authenticated + org-scoped, no role check — what routes.ts passes. */
const scopedSentinel: RequestHandler[] = [(_req, _res, next) => next()];

const settingsRoutes = captureRoutes((app) => registerSettingsOrgRoutes(app, scopedSentinel));
const setupRoutes = captureRoutes((app) => registerSetupAndImportRoutes(app));

/** Runs a whole registered chain and reports the status and body it produced. */
async function runChain(
  handlers: RequestHandler[],
  req: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  let status = 200;
  let body: any;
  let sent = false;
  const res: any = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: any) {
      body = payload;
      sent = true;
      return this;
    },
  };
  const request: any = { orgContext: { orgId: ORG_ID }, params: {}, query: {}, body: {}, headers: {}, ...req };
  for (const handler of handlers) {
    let advanced = false;
    await new Promise<void>((resolve) => {
      void (handler as any)(request, res, () => {
        advanced = true;
        resolve();
      });
      setImmediate(resolve);
    });
    if (sent || !advanced) break;
  }
  return { status, body };
}

const patchOrgSetup = () => {
  const chain = setupRoutes["PATCH /api/org/setup"];
  // Only the business handler: the guards in front of it are the real auth
  // middlewares, which need a live provider. Their role table is covered by
  // roleEnforcement.spec.ts; what matters here is what the handler saves.
  return chain[chain.length - 1];
};

beforeEach(() => {
  state.org = {
    id: ORG_ID,
    name: "Ops Settings Test",
    tradingName: null,
    opsPrepSlaMinutes: 20,
    opsDueSoonLeadMinutes: 10,
    opsLateGraceMinutes: 5,
    opsDeliveryLeadMinutes: 45,
    opsAutoClaimOnCreate: true,
    opsReconcilePollSeconds: 60,
    opsAlertOnSlaDue: false,
    opsKeepScreenAwake: true,
  };
  state.lastSet = null;
});

describe("operations settings round-trip", () => {
  it("saves every ops key and reads it back from /api/settings", async () => {
    const patch = {
      opsPrepSlaMinutes: 35,
      opsDueSoonLeadMinutes: 7,
      opsLateGraceMinutes: 2,
      opsDeliveryLeadMinutes: 90,
      opsAutoClaimOnCreate: false,
      opsReconcilePollSeconds: 30,
      opsAlertOnSlaDue: true,
      opsKeepScreenAwake: false,
    };

    const patched = await runChain([patchOrgSetup()], { body: patch });
    expect(patched.status).toBe(200);

    // The allow-list check: every key reached the UPDATE. A key missing from
    // `updateOrgProfile`'s array would be absent here and nowhere else.
    for (const [key, value] of Object.entries(patch)) {
      expect(state.lastSet?.[key], `${key} never reached the UPDATE`).toBe(value);
    }

    const read = await runChain(settingsRoutes["GET /api/settings"], {
      user: { id: "manager-1", role: "MANAGER" },
    });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject(patch);
  });

  it("projects the owner's defaults when the columns are still null", async () => {
    for (const key of Object.keys(state.org)) {
      if (key.startsWith("ops")) state.org[key] = null;
    }

    const read = await runChain(settingsRoutes["GET /api/settings"], {
      user: { id: "manager-1", role: "MANAGER" },
    });

    expect(read.body).toMatchObject({
      opsPrepSlaMinutes: 20,
      opsDueSoonLeadMinutes: 10,
      opsLateGraceMinutes: 5,
      opsDeliveryLeadMinutes: 45,
      // On by default (owner, Q4): a till order with nobody's name on it is
      // the case the default-owner rule exists to remove.
      opsAutoClaimOnCreate: true,
      opsReconcilePollSeconds: 60,
      // Off by default (owner, Q5): no alerts for orders with no promise.
      opsAlertOnSlaDue: false,
      opsKeepScreenAwake: true,
    });
  });

  it("refuses minutes outside the bounds rather than colouring the board with them", async () => {
    const rejected = await runChain([patchOrgSetup()], { body: { opsPrepSlaMinutes: 0 } });
    expect(rejected.status).toBe(400);
    expect(state.lastSet).toBeNull();

    const alsoRejected = await runChain([patchOrgSetup()], {
      body: { opsReconcilePollSeconds: 1 },
    });
    expect(alsoRejected.status).toBe(400);
    expect(state.lastSet).toBeNull();
  });
});

describe("cashier access to /api/settings", () => {
  it("has no role guard of its own beyond the shared org-scope chain", () => {
    // registerSettingsOrgRoutes may add `...scoped` and its handler, nothing
    // more: an extra guard here is a role check, and the board's own users are
    // cashiers.
    expect(settingsRoutes["GET /api/settings"]).toHaveLength(scopedSentinel.length + 1);
  });

  it("answers a CASHIER with the ops timing settings", async () => {
    const read = await runChain(settingsRoutes["GET /api/settings"], {
      user: { id: "cashier-1", role: "CASHIER" },
    });

    expect(read.status).toBe(200);
    expect(read.body.opsPrepSlaMinutes).toBe(20);
    expect(read.body.opsDueSoonLeadMinutes).toBe(10);
    expect(read.body.opsLateGraceMinutes).toBe(5);
    expect(read.body.opsDeliveryLeadMinutes).toBe(45);
    expect(read.body.opsAutoClaimOnCreate).toBe(true);
    expect(read.body.opsAlertOnSlaDue).toBe(false);
    expect(read.body.opsKeepScreenAwake).toBe(true);
    expect(read.body.opsReconcilePollSeconds).toBe(60);
  });
});
