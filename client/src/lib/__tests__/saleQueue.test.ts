import { describe, expect, it } from "vitest";
import {
  afterFailedSend,
  checkSaleLanded,
  countSaleQueue,
  isSaleDue,
  isSaleMine,
  referenceFor,
  replayPayload,
  sendSale,
} from "../saleQueue";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("a queued sale after a failed send", () => {
  it("waits longer each time, up to 15 minutes, when nothing was decided", () => {
    const now = 1_000_000;
    const first = afterFailedSend({}, null, "No connection", now);
    expect(first).toMatchObject({ state: "waiting", attempts: 1, nextAttemptAt: now + 30_000 });
    const sixth = afterFailedSend({ attempts: 5 }, 503, "busy", now);
    expect(sixth.nextAttemptAt).toBe(now + 15 * 60_000);
    const later = afterFailedSend({ attempts: 40 }, 500, "broken", now);
    expect(later.nextAttemptAt).toBe(now + 15 * 60_000);
  });

  it("is marked refused, not retried, when the server said no", () => {
    expect(afterFailedSend({ attempts: 2 }, 422, "Payments add up to £3.00", 0)).toEqual({
      state: "refused",
      lastError: "Payments add up to £3.00",
      httpStatus: 422,
    });
  });

  it("is sent only when due, unless a person asks, and a refusal is always reported", () => {
    expect(isSaleDue({ nextAttemptAt: 2000 }, 1000)).toBe(false);
    expect(isSaleDue({ nextAttemptAt: 2000 }, 1000, true)).toBe(true);
    expect(isSaleDue({ nextAttemptAt: 2000 }, 2000)).toBe(true);
    expect(isSaleDue({}, 0)).toBe(true);
    expect(isSaleDue({ state: "refused", nextAttemptAt: 9e15 }, 0)).toBe(true);
  });

  it("is only sent in the name of whoever rang it", () => {
    expect(isSaleMine({ queuedByUserId: "a" }, "a")).toBe(true);
    expect(isSaleMine({ queuedByUserId: "a" }, "b")).toBe(false);
    expect(isSaleMine({}, "b")).toBe(true);
  });

  it("carries its own reference and when it was really rung", () => {
    const body = replayPayload({ lines: [], paymentMethod: "cash" }, Date.UTC(2026, 8, 23, 10), "ref-12345678");
    expect(body).toMatchObject({
      clientOrderId: "ref-12345678",
      _offlineOrderReplay: true,
      _offlineQueuedAt: "2026-09-23T10:00:00.000Z",
    });
    expect(referenceFor({ clientOrderId: "ref-12345678" })).toBe("ref-12345678");
    expect(referenceFor({ clientOrderId: "bad ref" })).toBeNull();
    expect(referenceFor({}, "stored-12345678")).toBe("stored-12345678");
  });

  it("counts waiting and failed sales, ignoring other kinds and sent ones", () => {
    expect(
      countSaleQueue([
        { type: "ORDER_CREATE", synced: 0 },
        { type: "ORDER_CREATE", synced: 0, state: "waiting" },
        { type: "ORDER_CREATE", synced: 0, state: "refused" },
        { type: "ORDER_CREATE", synced: 1 },
        { type: "CUSTOMER_CREATE", synced: 0 },
      ]),
    ).toEqual({ waiting: 2, failed: 1 });
  });
});

describe("sending a sale", () => {
  it("returns the order on success", async () => {
    const outcome = await sendSale({}, { fetcher: async () => json(201, { orderId: "o1" }) });
    expect(outcome).toEqual({ ok: true, body: { orderId: "o1" } });
  });

  it("gives the server's own words for a refusal", async () => {
    const outcome = await sendSale({}, { fetcher: async () => json(422, { message: "Payments add up to £3.00" }) });
    expect(outcome).toMatchObject({ ok: false, status: 422, message: "Payments add up to £3.00", timedOut: false });
  });

  it("reports a timeout as no answer, not as a refusal", async () => {
    const never = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const outcome = await sendSale({}, { fetcher: never, timeoutMs: 10 });
    expect(outcome).toMatchObject({ ok: false, status: null, timedOut: true });
  });

  it("reports a dropped connection as no answer", async () => {
    const outcome = await sendSale({}, {
      fetcher: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(outcome).toMatchObject({ ok: false, status: null, timedOut: false });
  });
});

describe("did it land?", () => {
  it("says landed, not found, or unknown", async () => {
    expect(await checkSaleLanded("ref-12345678", { fetcher: async () => json(200, { found: true, orderId: "o1" }) }))
      .toMatchObject({ result: "landed", body: { orderId: "o1" } });
    expect(await checkSaleLanded("ref-12345678", { fetcher: async () => json(200, { found: false }) })).toEqual({
      result: "not_found",
    });
    expect(await checkSaleLanded("ref-12345678", { fetcher: async () => json(500, {}) })).toEqual({ result: "unknown" });
    expect(
      await checkSaleLanded("ref-12345678", {
        fetcher: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    ).toEqual({ result: "unknown" });
  });
});
