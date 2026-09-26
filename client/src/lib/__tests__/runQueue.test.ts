import { describe, expect, it } from "vitest";
import type { RunPayload, RunStop } from "@shared/orders/myRun";
import {
  applyQueuedTaps,
  clearRunSnapshots,
  enqueueRunTap,
  readRunQueue,
  readRunSnapshot,
  replayRunTaps,
  runTapRequest,
  saveRunSnapshot,
  splitStartable,
  writeRunQueue,
  type QueuedRunTap,
} from "../runQueue";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
    map,
  };
}

const stop = (id: string, out: boolean): RunStop => ({
  id,
  shortCode: id.slice(0, 8),
  customerName: "Jane Smith",
  hasCustomer: true,
  deliveryAddress: "5 Live Lane",
  deliveryPostcode: "LV1 1VE",
  deliveryNotes: null,
  deliveryIssue: null,
  deliveryIssueAt: null,
  itemCount: 1,
  total: "10.00",
  onTick: 0,
  dueAt: null,
  createdAt: null,
  readyAt: "2026-09-24T09:00:00.000Z",
  outForDeliveryAt: out ? "2026-09-24T09:10:00.000Z" : null,
  status: "pending",
  assignedUserId: "u1",
});

const tap = (over: Partial<QueuedRunTap>): QueuedRunTap => ({
  id: "t1",
  orgId: "org",
  userId: "u1",
  orderId: "o1",
  shortCode: "o1",
  kind: "delivered",
  tappedAt: "2026-09-24T10:00:00.000Z",
  ...over,
});

const run: RunPayload = {
  day: "2026-09-24",
  timezone: "Europe/London",
  driver: { userId: "u1", name: "Dee" },
  viewingOther: false,
  stops: [stop("o1", true)],
  drivers: [{ userId: "u1", name: "Dee" }],
};

describe("the copy of the run on the phone", () => {
  it("keeps your own run per org and person, without the driver list, and sign-out clears it", () => {
    const store = memoryStorage();
    saveRunSnapshot("org", "u1", run, 1000, store);
    const copy = readRunSnapshot("org", "u1", store);
    expect(copy?.savedAt).toBe(1000);
    expect(copy?.run.stops).toHaveLength(1);
    expect(copy?.run).not.toHaveProperty("drivers");
    expect(readRunSnapshot("org", "u2", store)).toBeNull();
    store.setItem("arcarna.other", "keep");
    clearRunSnapshots(store);
    expect(readRunSnapshot("org", "u1", store)).toBeNull();
    expect(store.getItem("arcarna.other")).toBe("keep");
  });

  it("never keeps a manager's look at someone else's run", () => {
    const store = memoryStorage();
    saveRunSnapshot("org", "m1", { ...run, viewingOther: true }, 1000, store);
    expect(store.length).toBe(0);
  });

  it("holds no phone number", () => {
    const store = memoryStorage();
    saveRunSnapshot("org", "u1", run, 1000, store);
    expect([...store.map.values()].join("")).not.toMatch(/phone|07\d{3}/i);
  });
});

describe("queued taps", () => {
  it("keeps one tap per order, the latest", () => {
    const q = enqueueRunTap([tap({ id: "a" })], tap({ id: "b", kind: "couldnt_deliver", reason: "no_answer" }));
    expect(q.map((t) => t.id)).toEqual(["b"]);
    const store = memoryStorage();
    writeRunQueue(q, store);
    expect(readRunQueue(store)).toEqual(q);
    writeRunQueue([], store);
    expect(store.length).toBe(0);
  });

  it("is sent through the same routes, with the time it was tapped", () => {
    expect(runTapRequest(tap({}))).toEqual({
      url: "/api/orders/o1/transition",
      body: { action: "complete", label: "delivered", actualAt: "2026-09-24T10:00:00.000Z", tapId: "t1" },
    });
    expect(runTapRequest(tap({ kind: "couldnt_deliver", reason: "refused", note: "said no" }))).toEqual({
      url: "/api/orders/o1/couldnt-deliver",
      body: { reason: "refused", note: "said no", tappedAt: "2026-09-24T10:00:00.000Z" },
    });
  });

  it("shows the run as the driver left it while taps wait", () => {
    const stops = [stop("o1", true), stop("o2", true), stop("o3", true)];
    const shown = applyQueuedTaps(stops, [
      tap({ orderId: "o1" }),
      tap({ id: "t2", orderId: "o2", kind: "couldnt_deliver", reason: "no_answer" }),
      tap({ id: "t3", orderId: "o3", state: "refused" }),
    ]);
    expect(shown.map((s) => s.id)).toEqual(["o2", "o3"]);
    expect(shown[0].outForDeliveryAt).toBeNull();
    expect(shown[0].deliveryIssue).toBe("Couldn't deliver: No answer");
  });

  it("replays only the signed-in person's taps: sent ones go, refused ones stay with the reason", async () => {
    const queue = [
      tap({ id: "ok", orderId: "o1" }),
      tap({ id: "no", orderId: "o2", kind: "couldnt_deliver", reason: "no_answer" }),
      tap({ id: "later", orderId: "o3" }),
      tap({ id: "theirs", orderId: "o4", userId: "u2" }),
    ];
    const sent: string[] = [];
    const send = async (url: string) => {
      sent.push(url);
      if (url.includes("o1")) return new Response("{}", { status: 200 });
      if (url.includes("o2")) return new Response(JSON.stringify({ message: "Not out", code: "NOT_OUT" }), { status: 409 });
      throw new TypeError("Failed to fetch");
    };
    const after = await replayRunTaps(queue, { orgId: "org", userId: "u1" }, send as any, { now: 1000 });
    expect(sent).toHaveLength(3);
    expect(after.map((t) => t.id)).toEqual(["no", "later", "theirs"]);
    expect(after[0]).toMatchObject({ state: "refused", lastError: "Not out" });
    expect(after[1]).toMatchObject({ state: "waiting", attempts: 1 });
    expect(after[1].nextAttemptAt).toBeGreaterThan(1000);

    // Not due yet: not sent again until the gap has passed, unless forced.
    sent.length = 0;
    await replayRunTaps(after, { orgId: "org", userId: "u1" }, send as any, { now: 1001 });
    expect(sent).toEqual([]);
  });

  it("drops a Delivered that finds the order already completed", async () => {
    const send = async () =>
      new Response(
        JSON.stringify({ code: "ORDER_TRANSITION_INVALID", message: 'cannot "complete" a completed order' }),
        { status: 409 },
      );
    const after = await replayRunTaps([tap({})], { orgId: "org", userId: "u1" }, send as any, { now: 1 });
    expect(after).toEqual([]);
  });

  it("drops a Delivered the server says this same tap already completed (reopened since)", async () => {
    const send = async () =>
      new Response(JSON.stringify({ code: "TAP_ALREADY_APPLIED", message: "already" }), { status: 409 });
    const after = await replayRunTaps([tap({})], { orgId: "org", userId: "u1" }, send as any, { now: 1 });
    expect(after).toEqual([]);
  });

  it("holds back from Start run a stop whose Couldn't deliver is still waiting", () => {
    const taps = [
      tap({ id: "a", orderId: "o1", kind: "couldnt_deliver", reason: "no_answer", state: "waiting" }),
      tap({ id: "b", orderId: "o2", kind: "couldnt_deliver", reason: "refused", state: "refused" }),
    ];
    expect(splitStartable(["o1", "o2", "o3"], taps)).toEqual({ start: ["o2", "o3"], held: ["o1"] });
    expect(splitStartable(["o1"], [])).toEqual({ start: ["o1"], held: [] });
  });
});
