import { describe, expect, it } from "vitest";
import { installFetchObserver, ScreenClock, UsageRecorder, USAGE_QUEUE_MAX, VIEW_CHUNK_MS, type UsageBatch } from "../usage/recorder";
import { usageBatchSchema } from "@shared/usage";

/** The till's side of our own usage record (v1.2 Phase 8B). */

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}

function setup(over: { online?: boolean; status?: number | Error } = {}) {
  let now = Date.parse("2026-09-24T09:00:00Z");
  const store = memoryStore();
  const sent: Array<{ orgId: string | null; batch: UsageBatch; keepalive: boolean }> = [];
  let org: string | null = "org-1";
  const rec = new UsageRecorder({
    now: () => now,
    store,
    queueKey: "q",
    deviceKeyKey: "k",
    orgId: () => org,
    device: () => "Till 2",
    appVersion: "1.2.0",
    random: () => 0.5,
    online: () => over.online ?? true,
    send: async (orgId, batch, { keepalive }) => {
      if (over.status instanceof Error) throw over.status;
      sent.push({ orgId, batch, keepalive });
      return over.status ?? 200;
    },
  });
  return {
    rec,
    store,
    sent,
    advance: (ms: number) => (now += ms),
    setOrg: (o: string | null) => (org = o),
    events: () => JSON.parse(store.getItem("q") ?? "[]").map((q: any) => q.event),
  };
}

describe("active time", () => {
  it("counts open time while visible, and active time only within 30 s of input", () => {
    const c = new ScreenClock(0);
    c.input(0);
    for (let t = 5_000; t <= 60_000; t += 5_000) c.advance(t);
    expect(c.take(60_000)).toEqual({ activeMs: 30_000, openMs: 60_000 });
  });

  it("counts nothing while hidden, and nothing across a sleep", () => {
    const c = new ScreenClock(0);
    c.input(0);
    c.setVisible(false, 10_000);
    c.advance(20_000);
    c.setVisible(true, 30_000);
    // The device slept for 10 minutes: not someone looking at the screen.
    c.advance(630_000);
    expect(c.take(630_000)).toEqual({ activeMs: 10_000, openMs: 10_000 });
  });
});

describe("what a device records", () => {
  it("records nothing until a member of staff is signed in", () => {
    const { rec, events } = setup();
    rec.setPath("/stock-levels");
    rec.message("Saved", "info");
    rec.crash("boundary");
    expect(events()).toEqual([]);
  });

  it("records a screen view with active and open time when the screen changes", () => {
    const { rec, events, advance } = setup();
    rec.setEnabled(true, "CASHIER");
    rec.setPath("/customers/3f2a9c1e-1111-4222-8333-444455556666", "?q=jane");
    rec.input();
    for (let i = 0; i < 12; i++) {
      advance(5_000);
      rec.tick();
    }
    rec.setPath("/stock-levels");
    const [view] = events();
    expect(view).toMatchObject({ kind: "screen", screen: "/customers/:id", activeMs: 30_000, openMs: 60_000 });
    expect(JSON.stringify(events())).not.toContain("jane");
  });

  it("tells the board from the till on the Operations Centre", () => {
    const { rec } = setup();
    rec.setEnabled(true, "CASHIER");
    rec.setPath("/operations");
    expect(rec.currentScreen()).toBe("/operations");
    rec.setPane("order");
    expect(rec.currentScreen()).toBe("/operations?pane=order");
    rec.setPane(null);
    expect(rec.currentScreen()).toBe("/operations");
    rec.setPane(undefined);
    rec.setPath("/stock-levels");
    rec.setPane("order");
    expect(rec.currentScreen()).toBe("/stock-levels");
  });

  it("sends a long stay on one screen in parts, marked as the same view", () => {
    const { rec, events, advance } = setup();
    rec.setEnabled(true, "CASHIER");
    rec.setPath("/operations");
    for (let t = 0; t < VIEW_CHUNK_MS; t += 5_000) {
      advance(5_000);
      rec.tick();
    }
    for (let t = 0; t < VIEW_CHUNK_MS; t += 5_000) {
      advance(5_000);
      rec.tick();
    }
    const views = events().filter((e: any) => e.kind === "screen");
    expect(views).toHaveLength(2);
    expect(views[0].cont).toBeUndefined();
    expect(views[1].cont).toBe(true);
    expect(views[0].activeMs).toBe(0);
    expect(views[0].openMs).toBe(VIEW_CHUNK_MS);
  });

  it("keeps a message's title only, calls only when slow or failed and as a route shape", () => {
    const { rec, events } = setup();
    rec.setEnabled(true, "CASHIER");
    rec.setPath("/operations", "?pane=order");
    rec.message({ not: "a string" }, "info");
    rec.message("Order failed", "error");
    rec.call("GET", "/arcarna/api/products", 200, 200);
    rec.call("POST", "/arcarna/api/orders?ref=abc", 2_000, 201);
    rec.call("GET", "/arcarna/api/customers/77", 90, 0);
    rec.call("OPTIONS", "/arcarna/api/customers", 5_000, 204);
    const ev = events();
    expect(ev.map((e: any) => e.kind)).toEqual(["message", "call", "call"]);
    expect(ev[0]).toMatchObject({ title: "Order failed", tone: "error", screen: "/operations?pane=order" });
    expect(ev[1]).toMatchObject({ method: "POST", route: "/api/orders", ms: 2_000, status: 201 });
    expect(ev[2]).toMatchObject({ route: "/api/customers/:id", status: 0 });
  });

  it("counts only a few script errors per page load", () => {
    const { rec, events } = setup();
    rec.setEnabled(true, "CASHIER");
    for (let i = 0; i < 20; i++) rec.crash("script");
    rec.crash("boundary");
    expect(events().filter((e: any) => e.crash === "script")).toHaveLength(5);
    expect(events().filter((e: any) => e.crash === "boundary")).toHaveLength(1);
  });

  it("every event it makes is one the server accepts", () => {
    const { rec, events } = setup();
    rec.setEnabled(true, "CASHIER");
    rec.setPath("/stock-levels");
    rec.message("Saved", "info");
    rec.call("GET", "/api/x", 5_000, 200);
    rec.crash("chunk");
    rec.offline(90_000);
    rec.funnel("pay");
    rec.endView();
    const parsed = usageBatchSchema.safeParse({ deviceKey: rec.deviceKey(), device: "Till 2", appVersion: "1.2.0", events: events() });
    expect(parsed.success).toBe(true);
  });

  it("keeps at most the newest events when it cannot send", () => {
    const { rec, events } = setup();
    rec.setEnabled(true, "CASHIER");
    for (let i = 0; i < USAGE_QUEUE_MAX + 10; i++) rec.funnel("start");
    expect(events()).toHaveLength(USAGE_QUEUE_MAX);
  });
});

describe("sending", () => {
  it("sends this shop's events in a batch with the device name and key, then forgets them", async () => {
    const { rec, sent, events, setOrg } = setup();
    rec.setEnabled(true, "CASHIER");
    rec.funnel("start");
    setOrg("org-2");
    rec.funnel("pay");
    setOrg("org-1");
    expect(await rec.flush()).toBe(1);
    expect(sent[0].orgId).toBe("org-1");
    expect(sent[0].batch).toMatchObject({ device: "Till 2", appVersion: "1.2.0" });
    expect(sent[0].batch.deviceKey).toMatch(/^[0-9a-z]{21}$/);
    expect(sent[0].batch.events.map((e) => (e as any).step)).toEqual(["start"]);
    // The other shop's event waits for that shop.
    expect(events()).toHaveLength(1);
    expect(rec.deviceKey()).toBe(sent[0].batch.deviceKey);
  });

  it("keeps events when offline, when there is no answer, and backs off on the device limit", async () => {
    const offline = setup({ online: false });
    offline.rec.setEnabled(true, "CASHIER");
    offline.rec.funnel("start");
    expect(await offline.rec.flush()).toBe(0);
    expect(offline.events()).toHaveLength(1);

    const down = setup({ status: new TypeError("Failed to fetch") });
    down.rec.setEnabled(true, "CASHIER");
    down.rec.funnel("start");
    expect(await down.rec.flush()).toBe(0);
    expect(down.events()).toHaveLength(1);

    const limited = setup({ status: 429 });
    limited.rec.setEnabled(true, "CASHIER");
    limited.rec.funnel("start");
    await limited.rec.flush();
    await limited.rec.flush();
    expect(limited.sent).toHaveLength(1);
    limited.advance(15 * 60_000);
    await limited.rec.flush();
    expect(limited.sent).toHaveLength(2);
    expect(limited.events()).toHaveLength(1);
  });

  it("sends events only while the role they were recorded under is signed in", async () => {
    const { rec, sent, store, advance } = setup();
    rec.setEnabled(true, "CASHIER");
    rec.setPath("/pos");
    advance(60_000);
    rec.funnel("start");
    // The cashier signs out offline; a manager signs in next on the same till.
    rec.setEnabled(false);
    rec.setEnabled(true, "MANAGER");
    expect(await rec.flush()).toBe(0);
    expect(sent).toHaveLength(0);
    rec.funnel("pay");
    expect(await rec.flush()).toBe(1);
    expect(sent[0].batch.events.map((e) => (e as any).step)).toEqual(["pay"]);
    // The cashier's events wait for a cashier.
    rec.setEnabled(true, "CASHIER");
    expect(await rec.flush()).toBe(2);
    expect(sent[1].batch.events.map((e) => e.kind)).toEqual(["funnel", "screen"]);
    // Events kept by an older build, with no role, cannot be placed and are dropped on load.
    store.setItem("q", JSON.stringify([{ orgId: "org-1", event: { kind: "funnel", step: "start" } }]));
    const again = new UsageRecorder({
      now: () => 0, store, queueKey: "q", deviceKeyKey: "k", orgId: () => "org-1", device: () => null,
      appVersion: "1", online: () => true, send: async () => 200,
    });
    expect(again.pending()).toBe(0);
  });

  it("closes the view under the old role when the role changes without a sign-out", () => {
    const { rec, store, advance } = setup();
    rec.setEnabled(true, "CASHIER");
    rec.setPath("/pos");
    rec.input();
    advance(10_000);
    rec.setEnabled(true, "MANAGER");
    const q = JSON.parse(store.getItem("q") ?? "[]");
    expect(q.map((x: any) => [x.role, x.event.kind])).toEqual([["CASHIER", "screen"]]);
  });

  it("drops a batch the server refused as malformed, so it cannot block the queue", async () => {
    const { rec, events } = setup({ status: 400 });
    rec.setEnabled(true, "CASHIER");
    rec.funnel("start");
    await rec.flush();
    expect(events()).toHaveLength(0);
  });
});

describe("timing calls at fetch", () => {
  it("times API calls, reports failures and slow give-ups as status 0, and leaves the usage batches and other URLs alone", async () => {
    const calls: Array<[string, string, number, number]> = [];
    let t = 0;
    const target = {
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input);
        t += url.includes("quick") ? 300 : url.includes("timeout") ? 12_000 : 2_000;
        if (url.includes("down")) throw new TypeError("Failed to fetch");
        if (url.includes("abort")) throw Object.assign(new Error("aborted"), { name: "AbortError" });
        return { status: 503 } as Response;
      }) as typeof fetch,
    };
    const undo = installFetchObserver(target, (...c) => void calls.push(c), () => t);
    await target.fetch("/arcarna/api/orders", { method: "post" });
    await expect(target.fetch("/arcarna/api/down")).rejects.toThrow();
    // Cancelled quickly (the person moved on): not friction.
    await expect(target.fetch("/arcarna/api/abort-quick")).rejects.toThrow();
    // The sale queue giving up on POST /api/orders at its 12s timeout: the worst sale friction.
    await expect(target.fetch("/arcarna/api/orders?abort-timeout", { method: "POST" })).rejects.toThrow();
    await target.fetch("/arcarna/api/usage/events", { method: "POST" });
    await target.fetch("/arcarna/sw.js");
    expect(calls).toEqual([
      ["POST", "/arcarna/api/orders", 2_000, 503],
      ["GET", "/arcarna/api/down", 2_000, 0],
      ["POST", "/arcarna/api/orders?abort-timeout", 12_000, 0],
    ]);
    undo();
  });
});
