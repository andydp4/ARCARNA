/**
 * The delivery address travels with the sale on every path (v1.2 Phase 5,
 * PRV-05): the till's order body, the offline queue's replay, and a refused
 * sale opened again from Needs attention. A regression here is a van with no
 * address.
 */
import { describe, expect, it } from "vitest";
import { deliveryOrderFields, EMPTY_POS_DELIVERY } from "@/components/pos-delivery-details";
import { replayPayload } from "../saleQueue";
import { readSaleIssuePayload } from "../saleIssueDraft";

const typed = { address: "5 Live Lane", postcode: "LV1 1VE", notes: "side door", saveAsCustomerAddress: true };

describe("the delivery address on every path", () => {
  it("the till's order body carries it for a delivery, and nothing for a collection", () => {
    expect(deliveryOrderFields("delivery", typed, "c1")).toEqual({
      deliveryAddress: "5 Live Lane",
      deliveryPostcode: "LV1 1VE",
      deliveryNotes: "side door",
      saveAsCustomerAddress: true,
    });
    expect(deliveryOrderFields("collection", typed, "c1")).toEqual({});
    // "Save as their address" needs someone to save it to.
    expect(deliveryOrderFields("delivery", typed, null)).not.toHaveProperty("saveAsCustomerAddress");
    expect(EMPTY_POS_DELIVERY.saveAsCustomerAddress).toBe(false);
  });

  it("the offline queue replays it unchanged", () => {
    const body = { lines: [], fulfilmentMethod: "delivery", ...deliveryOrderFields("delivery", typed, "c1") };
    const replay = replayPayload(body, Date.UTC(2026, 0, 1), "ref-1");
    expect(replay).toMatchObject({ deliveryAddress: "5 Live Lane", deliveryPostcode: "LV1 1VE", deliveryNotes: "side door" });
  });

  it("a refused sale reopened in the till gets its address back", () => {
    const sale = readSaleIssuePayload({
      lines: [{ productId: "p1", quantity: 1, unitPrice: 2 }],
      fulfilmentMethod: "delivery",
      deliveryAddress: "5 Live Lane",
      deliveryPostcode: "LV1 1VE",
    });
    expect(sale.delivery).toEqual({ address: "5 Live Lane", postcode: "LV1 1VE", notes: "" });
  });
});
