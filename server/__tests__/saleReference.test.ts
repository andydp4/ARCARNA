import { describe, expect, it } from "vitest";
import {
  alreadyRecordedResponse,
  isSaleReferenceConflict,
  readClientOrderId,
} from "../services/saleReference";

describe("the sale reference on POST /api/orders", () => {
  it("is optional, but refused rather than ignored when malformed", () => {
    expect(readClientOrderId({})).toEqual({ ok: true, value: null });
    expect(readClientOrderId({ clientOrderId: "" })).toEqual({ ok: true, value: null });
    expect(readClientOrderId({ clientOrderId: "0f8fad5b-d9cb-469f-a165-70867728950e" })).toEqual({
      ok: true,
      value: "0f8fad5b-d9cb-469f-a165-70867728950e",
    });
    expect(readClientOrderId({ clientOrderId: "drop table" }).ok).toBe(false);
    expect(readClientOrderId({ clientOrderId: 42 }).ok).toBe(false);
  });

  it("recognises the unique-index race, however deeply the driver wraps it", () => {
    const pgError = { code: "23505", constraint: "orders_org_client_order_id_uq", message: "duplicate key" };
    expect(isSaleReferenceConflict(pgError)).toBe(true);
    expect(isSaleReferenceConflict({ name: "DrizzleQueryError", cause: pgError })).toBe(true);
    expect(isSaleReferenceConflict({ code: "23505", constraint: "some_other_uq" })).toBe(false);
    expect(isSaleReferenceConflict(new Error("boom"))).toBe(false);
    expect(isSaleReferenceConflict(null)).toBe(false);
  });

  it("answers a repeat with the original order, marked as a repeat", () => {
    const body = alreadyRecordedResponse({
      id: "o1",
      status: "pending",
      total: "10.00",
      paymentMethod: "cash",
      createdAt: null,
      dateKind: null,
    });
    expect(body).toMatchObject({ orderId: "o1", duplicate: true, order: { id: "o1", total: "10.00", dateKind: "live" } });
  });
});
