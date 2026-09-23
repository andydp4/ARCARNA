import { describe, it, expect } from "vitest";
import {
  applyCustomerMatches,
  needsCustomerLookup,
  processQuickEntryTurn,
  type QuickEntryDraft,
} from "../assistant/quickEntry";
import type { IntentProduct } from "../whatsapp/intent";

const products: IntentProduct[] = [
  { productId: "PRD-1", name: "Product 1", aliases: [] },
  { productId: "PRD-2", name: "Product 2", aliases: [] },
];

/** One turn, with the customer lookup the server does in between. */
function turn(draft: QuickEntryDraft | null, text: string, customers: Array<{ id: string; name: string }> = []) {
  const t = processQuickEntryTurn(draft, text, products);
  return needsCustomerLookup(t.draft) ? applyCustomerMatches(t.draft, customers) : t;
}

describe("processQuickEntryTurn (v1.2 Phase 1B: drafts, never saved orders)", () => {
  it("walks order -> confirm -> a till draft, with no price, payment or expense questions", () => {
    const t1 = turn(null, "Bunny wants 50 Product 1 tomorrow.", [{ id: "c1", name: "Bunny" }]);
    expect(t1.action).toBe("ask");
    expect(t1.message).toBe("Ready to open in the till: Bunny, 50 Product 1, for tomorrow. Open it?");
    expect(t1.draft?.customerId).toBe("c1");
    expect(t1.draft?.items[0]).toEqual({ productId: "PRD-1", name: "Product 1", quantity: 50 });
    // No price is ever set by the assistant: the till prices each product.
    expect(t1.draft?.items[0]).not.toHaveProperty("unitPrice");
    expect(t1.draft).not.toHaveProperty("paymentMethod");

    const t2 = turn(t1.draft, "Yes.");
    expect(t2.action).toBe("draft");
    expect(t2.draft).toBeNull();
    expect(t2.tillDraft).toEqual({
      customerId: "c1",
      customerName: "Bunny",
      items: [{ sku: "PRD-1", name: "Product 1", quantity: 50 }],
      note: expect.stringMatching(/^For tomorrow/),
    });
  });

  it("never produces a 'save' action", () => {
    const draft = turn(null, "Bunny wants 10 Product 2", [{ id: "c1", name: "Bunny" }]).draft;
    const t = turn(draft, "yes");
    expect(t.action).not.toBe("save");
  });

  it("asks who the order is for when no name is given", () => {
    const t1 = turn(null, "50 Product 1 tomorrow");
    expect(t1.message).toBe("Who is this order for?");
    const t2 = turn(t1.draft, "Bunny", [{ id: "c1", name: "Bunny" }]);
    expect(t2.draft?.customerName).toBe("Bunny");
    expect(t2.draft?.status).toBe("confirming");
  });

  it("asks which customer is meant when a name matches several, and takes a number", () => {
    const matches = [
      { id: "c1", name: "Bunny Smith" },
      { id: "c2", name: "Bunny Jones" },
    ];
    const t1 = turn(null, "Bunny wants 1 Product 1", matches);
    expect(t1.action).toBe("ask");
    expect(t1.draft?.status).toBe("choosing-customer");
    expect(t1.message).toContain("1. Bunny Smith, 2. Bunny Jones");
    expect(t1.draft?.customerId).toBeUndefined();

    const t2 = turn(t1.draft, "2");
    expect(t2.draft?.customerId).toBe("c2");
    expect(t2.draft?.customerName).toBe("Bunny Jones");
    expect(t2.draft?.status).toBe("confirming");
  });

  it("takes a name only one candidate has, and re-asks when the answer is unclear", () => {
    const matches = [
      { id: "c1", name: "Bunny Smith" },
      { id: "c2", name: "Bunny Jones" },
    ];
    const t1 = turn(null, "Bunny wants 1 Product 1", matches);
    const unclear = turn(t1.draft, "Bunny");
    expect(unclear.draft?.status).toBe("choosing-customer");
    const t2 = turn(t1.draft, "jones");
    expect(t2.draft?.customerId).toBe("c2");
  });

  it("leaves the customer to the till when nobody matches or 'none' is said — never creates one", () => {
    const nobody = turn(null, "Zed wants 1 Product 1", []);
    expect(nobody.draft?.customerId).toBeNull();
    expect(nobody.message).toContain("pick the customer in the till");
    const yes = turn(nobody.draft, "yes");
    expect(yes.tillDraft?.customerId).toBeNull();
    expect(yes.tillDraft?.customerName).toBe("Zed");

    const matches = [
      { id: "c1", name: "Bunny Smith" },
      { id: "c2", name: "Bunny Jones" },
    ];
    const choosing = turn(null, "Bunny wants 1 Product 1", matches);
    const none = turn(choosing.draft, "none of them");
    expect(none.draft?.customerId).toBeNull();
    expect(none.draft?.status).toBe("confirming");
  });

  it("cancels a confirming draft on 'no'", () => {
    const draft = turn(null, "Bunny wants 10 Product 2", [{ id: "c1", name: "Bunny" }]).draft;
    const t = turn(draft, "no");
    expect(t.action).toBe("cancel");
    expect(t.draft).toBeNull();
  });

  it("re-prompts for an order when nothing is recognized", () => {
    const t = turn(null, "hi there");
    expect(t.action).toBe("ask");
    expect(t.draft).toBeNull();
  });
});
