/**
 * `GET /api/orders/board/stream` (N3a).
 *
 * The one test that matters most here, and the one written first: an event
 * published for org B must be structurally unreachable from org A's
 * connection — `opsBus.ts` keys its `EventEmitter` by org id, so this proves
 * it by publishing to org B and asserting NOTHING org A's socket received
 * mentions it, not merely that a filter happened to catch it.
 *
 * `../db` is mocked to record every `insert`/`select` call rather than touch
 * a database: the route's own contract is that it NEVER selects (everything
 * it sends is relayed from `opsBus`, not read fresh), and that presence is a
 * throttled UPSERT, not a read. A `select` call here is treated as a bug,
 * not a fixture to fill in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({ insertCalls: 0, selectCalls: 0 }));

vi.mock("../db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => {
          state.insertCalls += 1;
          return Promise.resolve();
        },
      }),
    }),
    select: () => {
      state.selectCalls += 1;
      throw new Error("opsStream route must never SELECT — everything comes from opsBus");
    },
  },
}));

const { registerOpsStreamRoutes } = await import("../routes/opsStream");
const opsBus = await import("../services/opsBus");
const { __resetPresenceThrottleForTests } = await import("../routes/opsStream");

const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const ORG_B = "00000000-0000-4000-8000-0000000000bb";

function captureHandler() {
  let handler: any;
  registerOpsStreamRoutes(
    { get: (_path: string, ...handlers: any[]) => { handler = handlers[handlers.length - 1]; } } as any,
    [],
  );
  return handler;
}

/**
 * Drains the real microtask queue a few times over. Fake timers (below) only
 * fake macrotask-based timer functions (`setTimeout`/`setInterval`); the
 * route's presence touch is `void`-fired and chains a dynamic `import()` plus
 * two more `await`s, all of which are ordinary microtasks that run whether or
 * not fake timers are active.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function fakeConnection(orgId: string, userId: string, lastEventId?: number) {
  const listeners: Record<string, Array<() => void>> = {};
  const writes: string[] = [];
  const headers: Record<string, string> = {};
  const req: any = {
    orgContext: { orgId },
    user: { id: userId },
    headers: lastEventId !== undefined ? { "last-event-id": String(lastEventId) } : {},
    query: {},
    on: (event: string, cb: () => void) => {
      (listeners[event] ??= []).push(cb);
    },
  };
  const res: any = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    flushHeaders: vi.fn(),
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
    flush: vi.fn(),
    on: (event: string, cb: () => void) => {
      (listeners[event] ??= []).push(cb);
    },
  };
  return {
    req,
    res,
    headers,
    writes,
    text: () => writes.join(""),
    close: () => listeners.close?.forEach((cb) => cb()),
  };
}

beforeEach(() => {
  state.insertCalls = 0;
  state.selectCalls = 0;
  opsBus.__resetOpsBusForTests();
  __resetPresenceThrottleForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("org scoping", () => {
  it("never lets an event published for org B reach org A's stream", () => {
    const handler = captureHandler();
    const a = fakeConnection(ORG_A, "user-a");
    const b = fakeConnection(ORG_B, "user-b");
    handler(a.req, a.res);
    handler(b.req, b.res);

    opsBus.publishOpsEvent(ORG_B, { type: "order_removed", id: "order-b-only" });

    expect(a.text()).not.toContain("order-b-only");
    expect(b.text()).toContain("order-b-only");

    opsBus.publishOpsEvent(ORG_A, { type: "order_removed", id: "order-a-only" });
    expect(b.text()).not.toContain("order-a-only");
    expect(a.text()).toContain("order-a-only");

    a.close();
    b.close();
  });
});

describe("headers, ping and presence", () => {
  it("sets SSE headers, flushes on connect, and sends retry: 3000", () => {
    const handler = captureHandler();
    const conn = fakeConnection(ORG_A, "user-a");
    handler(conn.req, conn.res);

    expect(conn.headers["Content-Type"]).toBe("text/event-stream");
    expect(conn.headers["Cache-Control"]).toContain("no-cache");
    expect(conn.res.flushHeaders).toHaveBeenCalled();
    expect(conn.text()).toContain("retry: 3000");

    conn.close();
  });

  it("pings every 25s and throttles the presence write to once per 60s", async () => {
    vi.useFakeTimers();
    const handler = captureHandler();
    const conn = fakeConnection(ORG_A, "user-a");
    handler(conn.req, conn.res);

    // The connection's own initial touch and its first ping both land inside
    // one 60s throttle window, so either way there is exactly one write by
    // the time the first ping has fired.
    await vi.advanceTimersByTimeAsync(25_000);
    await flushMicrotasks();
    expect(conn.text()).toContain(": ping");
    expect(state.insertCalls).toBe(1);

    // Pings at 25s and 50s are both still inside the connect-time touch's
    // 60s window (last write was at t=0); the one at 75s is the first past
    // it.
    await vi.advanceTimersByTimeAsync(50_001); // 75.001s total
    await flushMicrotasks();
    expect(state.insertCalls).toBe(2);

    conn.close();
  });

  it("never SELECTs — four idle connections over 60s cost zero reads", async () => {
    vi.useFakeTimers();
    const handler = captureHandler();
    const conns = ["u1", "u2", "u3", "u4"].map((u) => fakeConnection(ORG_A, u));
    for (const c of conns) handler(c.req, c.res);

    await vi.advanceTimersByTimeAsync(60_000);
    await flushMicrotasks();

    expect(state.selectCalls).toBe(0);
    // One throttled presence UPSERT per connected user, not per ping.
    expect(state.insertCalls).toBe(4);

    for (const c of conns) c.close();
  });
});

describe("replay and gap detection", () => {
  it("replays only events after Last-Event-ID on reconnect", () => {
    const handler = captureHandler();
    const first = fakeConnection(ORG_A, "user-a");
    handler(first.req, first.res);

    const e1 = opsBus.publishOpsEvent(ORG_A, { type: "order_removed", id: "e1" });
    const e2 = opsBus.publishOpsEvent(ORG_A, { type: "order_removed", id: "e2" });
    first.close();

    const reconnect = fakeConnection(ORG_A, "user-a", e1.id);
    handler(reconnect.req, reconnect.res);

    expect(reconnect.text()).not.toContain(`id: ${e1.id}\n`);
    expect(reconnect.text()).toContain(`id: ${e2.id}\n`);
    expect(reconnect.text()).toContain("e2");

    reconnect.close();
  });

  it("tells the client to reload when an id between Last-Event-ID and the retained ring was evicted", () => {
    // Three events, but the client only ever saw the first: it drops off
    // right after `e1`, and by the time it reconnects `e1` AND `e2` have
    // both aged out of the 5-minute ring — id 2 is gone for good, so
    // replaying "everything after 1" would silently skip it.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const e1 = opsBus.publishOpsEvent(ORG_A, { type: "order_removed", id: "e1" });
    opsBus.publishOpsEvent(ORG_A, { type: "order_removed", id: "e2" });

    vi.setSystemTime(new Date("2026-01-01T00:06:00Z")); // past the 5-minute window
    opsBus.publishOpsEvent(ORG_A, { type: "order_removed", id: "e3" });

    const handler = captureHandler();
    const reconnect = fakeConnection(ORG_A, "user-a", e1.id);
    handler(reconnect.req, reconnect.res);

    expect(reconnect.text()).toContain("event: reload");
    expect(reconnect.text()).not.toContain("e3"); // told to reload, not handed a hole-y replay
    reconnect.close();
  });

  it("replays cleanly (no gap) when the next id is simply the very next one", () => {
    // Losing exactly the event whose id the client already has is not a gap
    // — there is nothing between what it saw and what is being replayed.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const e1 = opsBus.publishOpsEvent(ORG_A, { type: "order_removed", id: "e1" });

    vi.setSystemTime(new Date("2026-01-01T00:06:00Z"));
    const e2 = opsBus.publishOpsEvent(ORG_A, { type: "order_removed", id: "e2" });

    const handler = captureHandler();
    const reconnect = fakeConnection(ORG_A, "user-a", e1.id);
    handler(reconnect.req, reconnect.res);

    expect(reconnect.text()).not.toContain("event: reload");
    expect(reconnect.text()).toContain(`id: ${e2.id}\n`);
    reconnect.close();
  });

  it("does not treat a first connection (no Last-Event-ID) as a gap", () => {
    const handler = captureHandler();
    const conn = fakeConnection(ORG_A, "user-a");
    handler(conn.req, conn.res);
    expect(conn.text()).not.toContain("event: reload");
    conn.close();
  });
});

describe("org context", () => {
  it("refuses a connection with no org context", () => {
    const handler = captureHandler();
    const req: any = { orgContext: { orgId: null }, user: { id: "u" }, headers: {}, query: {}, on: () => {} };
    let statusCode = 0;
    let body: any;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: any) {
        body = payload;
      },
    };
    handler(req, res);
    expect(statusCode).toBe(400);
    expect(body?.message).toBeTruthy();
  });
});
