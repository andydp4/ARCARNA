import { describe, it, expect } from "vitest";
import { processQuickEntryTurn, type QuickEntryDraft } from "../assistant/quickEntry";
import type { IntentProduct } from "../whatsapp/intent";

const products: IntentProduct[] = [
  { productId: "PRD-1", name: "Product 1", aliases: [] },
  { productId: "PRD-2", name: "Product 2", aliases: [] },
];

describe("processQuickEntryTurn", () => {
  it("walks the full example flow: order -> price -> expenses -> confirm -> save", () => {
    let draft: QuickEntryDraft | null = null;

    const t1 = processQuickEntryTurn(draft, "Bunny wants 50 Product 1 tomorrow.", products);
    expect(t1.action).toBe("ask");
    expect(t1.message).toBe("What price per item?");
    draft = t1.draft;
    expect(draft?.customerName).toBe("Bunny");
    expect(draft?.items[0]).toMatchObject({ name: "Product 1", quantity: 50 });
    expect(draft?.fulfillment?.label).toBe("tomorrow");

    const t2 = processQuickEntryTurn(draft, "£20 each.", products);
    expect(t2.action).toBe("ask");
    expect(t2.message).toBe("Any expenses?");
    draft = t2.draft;
    expect(draft?.items[0].unitPrice).toBe(20);

    const t3 = processQuickEntryTurn(draft, "£30 train.", products);
    expect(t3.action).toBe("ask");
    expect(t3.message).toBe("Ready to save: Bunny, 50 Product 1 at £20 each, train expense £30. Save it?");
    draft = t3.draft;
    expect(draft?.status).toBe("confirming");
    expect(draft?.expenses).toEqual([{ amount: 30, label: "train" }]);

    const t4 = processQuickEntryTurn(draft, "Yes.", products);
    expect(t4.action).toBe("save");
    expect(t4.voiceResponse).toBe("Done. Order saved.");
  });

  it("asks who the order is for when no name is given", () => {
    const t1 = processQuickEntryTurn(null, "50 Product 1 tomorrow", products);
    expect(t1.message).toBe("Who is this order for?");
    const t2 = processQuickEntryTurn(t1.draft, "Bunny", products);
    expect(t2.message).toBe("What price per item?");
    expect(t2.draft?.customerName).toBe("Bunny");
  });

  it("treats 'none' as no expenses and moves straight to confirmation", () => {
    let draft: QuickEntryDraft | null = null;
    draft = processQuickEntryTurn(draft, "Bunny wants 10 Product 2", products).draft;
    draft = processQuickEntryTurn(draft, "£5 each", products).draft;
    const t = processQuickEntryTurn(draft, "none", products);
    expect(t.message).toBe("Ready to save: Bunny, 10 Product 2 at £5 each. Save it?");
  });

  it("cancels a confirming order on 'no'", () => {
    let draft: QuickEntryDraft | null = null;
    draft = processQuickEntryTurn(draft, "Bunny wants 10 Product 2", products).draft;
    draft = processQuickEntryTurn(draft, "£5 each", products).draft;
    draft = processQuickEntryTurn(draft, "none", products).draft;
    const t = processQuickEntryTurn(draft, "no", products);
    expect(t.action).toBe("cancel");
    expect(t.draft).toBeNull();
  });

  it("re-prompts for an order when nothing is recognized", () => {
    const t = processQuickEntryTurn(null, "hi there", products);
    expect(t.action).toBe("ask");
    expect(t.draft).toBeNull();
  });

  it("defaults payment method to tick unless stated", () => {
    const t = processQuickEntryTurn(null, "Bunny wants 1 Product 1", products);
    expect(t.draft?.paymentMethod).toBe("tick");
  });

  it("picks up an explicit payment method", () => {
    const t = processQuickEntryTurn(null, "Bunny wants 1 Product 1, paid by card", products);
    expect(t.draft?.paymentMethod).toBe("card");
  });
});
