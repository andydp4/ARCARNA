import { describe, expect, it } from "vitest";
import {
  SALE_LANDED_CHECK_TIMEOUT_MS,
  SALE_RETRY_MAX_MS,
  SALE_SUBMIT_TIMEOUT_MS,
  classifySaleSendFailure,
  formatSaleQueueStatus,
  isValidClientOrderId,
  nextSaleRetryDelayMs,
} from "./saleReference";

describe("sale reference", () => {
  it("accepts a uuid and refuses anything that could smuggle text", () => {
    expect(isValidClientOrderId("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
    expect(isValidClientOrderId("sale-lx2k9-abcdef12")).toBe(true);
    expect(isValidClientOrderId("short")).toBe(false);
    expect(isValidClientOrderId("has space in it")).toBe(false);
    expect(isValidClientOrderId("x".repeat(65))).toBe(false);
    expect(isValidClientOrderId(12345678)).toBe(false);
    expect(isValidClientOrderId(undefined)).toBe(false);
  });

  it("waits 12 to 15 seconds for a sale before asking whether it landed", () => {
    expect(SALE_SUBMIT_TIMEOUT_MS).toBeGreaterThanOrEqual(12_000);
    expect(SALE_SUBMIT_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
    expect(SALE_LANDED_CHECK_TIMEOUT_MS).toBeLessThan(SALE_SUBMIT_TIMEOUT_MS);
  });

  it("backs off from 30 seconds, doubling, never more than 15 minutes apart", () => {
    expect([1, 2, 3, 4, 5].map(nextSaleRetryDelayMs)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000]);
    expect(nextSaleRetryDelayMs(6)).toBe(15 * 60_000);
    expect(nextSaleRetryDelayMs(500)).toBe(SALE_RETRY_MAX_MS);
    expect(nextSaleRetryDelayMs(0)).toBe(30_000);
    expect(nextSaleRetryDelayMs(Number.NaN)).toBe(30_000);
  });

  it("retries what was not decided and hands refusals to a manager", () => {
    for (const status of [null, undefined, 500, 502, 503, 401, 403, 408, 429]) {
      expect(classifySaleSendFailure(status), String(status)).toBe("retry");
    }
    for (const status of [400, 404, 409, 422]) {
      expect(classifySaleSendFailure(status), String(status)).toBe("refused");
    }
  });

  it("reads '2 waiting · 1 failed', leaving out a zero", () => {
    expect(formatSaleQueueStatus(2, 1)).toBe("2 waiting · 1 failed");
    expect(formatSaleQueueStatus(2, 0)).toBe("2 waiting");
    expect(formatSaleQueueStatus(0, 1)).toBe("1 failed");
    expect(formatSaleQueueStatus(0, 0)).toBe("");
  });
});
