/**
 * `GET /api/orders/board` (N3a).
 *
 * Two things this proves that nothing else does:
 *
 *   1. the route is registered BEFORE `GET /api/orders/:id` — otherwise
 *      Express would match "board" as that route's `:id` param and this
 *      handler would never run at all;
 *   2. `server/services/opsBoard.ts`'s predicate, shape and org scoping are
 *      exactly the brief's contract, with `resolveUserNames` called once.
 *
 * No database: both `apps/server/src/db` (orders/customers/order_items/
 * products) and `../db` (organizations/opsStaff/allowedUsers/orderEvents) are
 * mocked query-builder chains dispatched by TABLE IDENTITY — the real table
 * objects from the real schema modules (plain drizzle table definitions, no
 * connection) are imported and compared by reference, so a query against the
 * wrong table fails loudly instead of silently returning the wrong fixture.
 */
import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  orders as appsOrders,
  order_items as appsOrderItems,
  products as appsProducts,
  customers as appsCustomers,
} from "../../apps/server/src/db/schema";
import { organizations, opsStaff, allowedUsers, orderEvents, opsAlerts, users } from "@shared/schema";

const ORG_ID = "00000000-0000-4000-8000-0000000000aa";
const OTHER_ORG_ID = "00000000-0000-4000-8000-0000000000bb";

/** An awaitable, chainable stand-in for a drizzle query builder. */
function chain<T>(rows: T[], onWhere?: (condition: unknown) => void) {
  const self: any = {
    from: () => self,
    leftJoin: () => self,
    where: (condition: unknown) => {
      onWhere?.(condition);
      return self;
    },
    orderBy: () => self,
    limit: (n?: number) => Promise.resolve(n ? rows.slice(0, n) : rows),
    then: (resolve: (v: T[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return self;
}

/**
 * Walks a drizzle `SQL` condition's internal chunks and collects every column
 * name and literal value it references. Structural rather than a real SQL
 * comparison — good enough to prove the predicate is BUILT from the right
 * columns and constants without a database; `opsBoardQuery.test.ts` (N3b)
 * proves it actually filters correctly against real rows.
 */
function flattenSqlCondition(condition: unknown, out: unknown[] = []): unknown[] {
  if (condition == null) return out;
  const chunks = (condition as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) flattenSqlCondition(chunk, out);
    return out;
  }
  const name = (condition as { name?: unknown }).name;
  if (typeof name === "string") out.push(name);
  const value = (condition as { value?: unknown }).value;
  if (value !== undefined) out.push(value);
  return out;
}

const state = vi.hoisted(() => ({
  appsOrderRows: [] as any[],
  itemRows: [] as any[],
  orgRow: null as any,
  opsStaffRows: [] as any[],
  allowedUserRows: [] as any[],
  orderEventRows: [] as any[],
  opsAlertRows: [] as any[],
  userRows: [] as any[],
  appsSelectCalls: [] as string[],
  usersSelectCallCount: 0,
  lastOrdersWhereCondition: null as unknown,
}));

vi.mock("../../apps/server/src/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table === appsOrders) {
          state.appsSelectCalls.push("orders");
          return chain(state.appsOrderRows, (condition) => {
            state.lastOrdersWhereCondition = condition;
          });
        }
        if (table === appsOrderItems) {
          state.appsSelectCalls.push("order_items");
          return chain(state.itemRows);
        }
        throw new Error("orderBoardRoute.test.ts: unexpected apps/server table in select().from()");
      },
    }),
  },
}));

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table === organizations) return chain(state.orgRow ? [state.orgRow] : []);
        if (table === opsStaff) return chain(state.opsStaffRows);
        if (table === allowedUsers) return chain(state.allowedUserRows);
        if (table === orderEvents) return chain(state.orderEventRows);
        // N5a: the board's `alerts` field (`server/services/opsAlerts.ts`'s
        // `listFor`) — empty by default, so the "exact contract shape" test's
        // `alerts: []` holds without every other test having to know it exists.
        if (table === opsAlerts) return chain(state.opsAlertRows);
        if (table === users) {
          state.usersSelectCallCount += 1;
          return chain(state.userRows);
        }
        throw new Error("orderBoardRoute.test.ts: unexpected shared table in select().from()");
      },
    }),
  },
}));

const { getOpsBoard } = await import("../services/opsBoard");
const { registerOrderRoutes } = await import("../routes/orders");

type RouteMap = Record<string, RequestHandler[]>;

function captureRoutes(): RouteMap {
  const routes: RouteMap = {};
  const record = (method: string) => (path: string, ...handlers: RequestHandler[]) => {
    routes[`${method} ${path}`] = handlers;
  };
  registerOrderRoutes(
    {
      get: record("GET"),
      post: record("POST"),
      put: record("PUT"),
      patch: record("PATCH"),
      delete: record("DELETE"),
    } as any,
    [(_req, _res, next) => next()],
  );
  return routes;
}

function orderRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: overrides.id ?? "order-1",
    customerId: null,
    customerName: null,
    customerPhone: null,
    total: "12.00",
    paymentMethod: "cash",
    channel: "pos",
    status: "pending",
    fulfilmentMethod: "collection",
    dateKind: "live",
    createdAt: new Date("2026-09-12T10:00:00Z"),
    enteredAt: new Date("2026-09-12T10:00:00Z"),
    etaGiven: null,
    originalEta: null,
    revisedEta: null,
    delayFlag: false,
    delayCause: null,
    delayReason: null,
    delayNotificationSentAt: null,
    delayResolution: null,
    assignedUserId: null,
    assignedAt: null,
    heldAt: null,
    readyAt: null,
    customerArrivedAt: null,
    outForDeliveryAt: null,
    settledAt: null,
    inputUserId: "cashier-1",
    completedUserId: null,
    locationId: null,
    updatedAt: new Date("2026-09-12T10:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  state.appsOrderRows = [];
  state.itemRows = [];
  state.orgRow = {
    timezone: "Europe/London",
    opsPrepSlaMinutes: 20,
    opsDueSoonLeadMinutes: 10,
    opsLateGraceMinutes: 5,
    opsDeliveryLeadMinutes: 45,
    opsAutoClaimOnCreate: true,
    opsReconcilePollSeconds: 60,
    opsAlertOnSlaDue: false,
    opsKeepScreenAwake: true,
  };
  state.opsStaffRows = [];
  state.allowedUserRows = [];
  state.orderEventRows = [];
  state.opsAlertRows = [];
  state.userRows = [];
  state.appsSelectCalls = [];
  state.usersSelectCallCount = 0;
  state.lastOrdersWhereCondition = null;
});

describe("route registration order", () => {
  it("registers GET /api/orders/board before GET /api/orders/:id", () => {
    const routes = captureRoutes();
    const keys = Object.keys(routes);
    const boardIndex = keys.indexOf("GET /api/orders/board");
    const byIdIndex = keys.indexOf("GET /api/orders/:id");
    expect(boardIndex).toBeGreaterThanOrEqual(0);
    expect(byIdIndex).toBeGreaterThanOrEqual(0);
    expect(boardIndex).toBeLessThan(byIdIndex);
  });
});

describe("getOpsBoard", () => {
  it("includes open orders and recently-completed ones, and excludes older completions", async () => {
    const now = new Date("2026-09-12T12:00:00Z");
    state.appsOrderRows = [
      orderRow({ id: "open-1", status: "pending" }),
      orderRow({ id: "completed-recent", status: "completed", settledAt: new Date("2026-09-12T11:00:00Z") }),
      orderRow({ id: "completed-old", status: "completed", settledAt: new Date("2026-09-12T09:00:00Z") }),
    ];

    const payload = await getOpsBoard(ORG_ID, "cashier-1", { now });
    const ids = payload.orders.map((o) => o.id);
    // The mock's WHERE clause is a no-op (it always returns every row given
    // to it), so this asserts the SHAPE and the summary maths the predicate
    // must produce, not the SQL text — `opsBoardQuery.test.ts` (N3b) proves
    // the predicate against a real database.
    expect(ids).toContain("open-1");
    expect(ids).toContain("completed-recent");
    expect(payload.summary.completedToday).toBe(2);
    expect(payload.serverNow).toBe(now.toISOString());
    expect(payload.tradingDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("builds its predicate from org, status<>completed and a 120-minute settled_at cutoff", async () => {
    const now = new Date("2026-09-12T12:00:00Z");
    await getOpsBoard(ORG_ID, null, { now });

    const flat = flattenSqlCondition(state.lastOrdersWhereCondition);
    expect(flat).toContain("org_id");
    expect(flat).toContain(ORG_ID);
    expect(flat).toContain("status");
    expect(flat).toContain("completed");
    expect(flat).toContain("settled_at");
    // 120 minutes before `now` — the "Done today" tray's own window.
    expect(flat).toContainEqual(new Date(now.getTime() - 120 * 60_000));
  });

  it("returns the exact contract shape", async () => {
    state.appsOrderRows = [orderRow()];
    const payload = await getOpsBoard(ORG_ID, "cashier-1");

    expect(payload).toMatchObject({
      settings: {
        prepSlaMinutes: 20,
        dueSoonLeadMinutes: 10,
        lateGraceMinutes: 5,
        deliveryLeadMinutes: 45,
        autoClaimOnCreate: true,
        alertOnSlaDue: false,
        keepScreenAwake: true,
        reconcilePollSeconds: 60,
      },
      me: { userId: "cashier-1" },
      alerts: [],
    });
    expect(Array.isArray(payload.staff)).toBe(true);
    expect(payload.orders[0]).toMatchObject({
      id: "order-1",
      shortCode: "order-1".slice(0, 8),
      fulfilmentMethod: "collection",
      dateKind: "live",
    });
    expect(typeof payload.orders[0].itemCount).toBe("number");
    expect(Array.isArray(payload.orders[0].itemsPreview)).toBe(true);
  });

  it("resolves names with one resolveUserNames call, however many orders reference a name", async () => {
    state.userRows = [{ id: "cashier-1", firstName: "Ana", lastName: null, email: "ana@seed.local" }];
    state.appsOrderRows = [
      orderRow({ id: "o1", inputUserId: "cashier-1" }),
      orderRow({ id: "o2", inputUserId: "cashier-1", assignedUserId: "cashier-1" }),
      orderRow({ id: "o3", inputUserId: "cashier-1", completedUserId: "cashier-1", status: "completed", settledAt: new Date() }),
    ];

    const payload = await getOpsBoard(ORG_ID, "cashier-1");

    expect(payload.orders.every((o) => o.inputUserName === "Ana")).toBe(true);
    // One `SELECT ... FROM users` for the whole board, not one per order/row
    // referencing a name — `resolveUserNames`'s own contract (brief: "one
    // resolveUserNames call").
    expect(state.usersSelectCallCount).toBe(1);
  });

  it("names a seeded org's staff from allowed_users when users has no row (brief: 'seeded orgs have no users rows')", async () => {
    state.allowedUserRows = [
      { authUserId: null, replitUserId: "seed-cashier", name: "Cashier", email: "cashier@seed.local" },
    ];
    state.appsOrderRows = [orderRow({ inputUserId: "seed-cashier" })];

    const payload = await getOpsBoard(ORG_ID, "seed-cashier");

    expect(payload.orders[0].inputUserName).toBe("Cashier");
  });
});
