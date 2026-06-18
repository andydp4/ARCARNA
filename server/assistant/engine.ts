/**
 * Arcarna Assistant orchestration — wires the pure QuickEntryEngine to
 * product lookup and order persistence. Shared by every input channel
 * (typed command bar, mic, Siri Shortcuts, future WhatsApp voice notes).
 */
import { storage } from "../storage";
import { processQuickEntryTurn, type QuickEntryDraft, type QuickEntryTurnResult } from "./quickEntry";
import { getProductsForAssistant, findOrCreateCustomerByName, resolveOrderLines } from "./store";

export interface AssistantTurnResult extends QuickEntryTurnResult {
  /** Set when action === "save": the order that was actually created. */
  savedOrderId?: string;
}

/** Advances the conversation by one turn, saving the order if it's confirmed. */
export async function runAssistantTurn(
  orgId: string,
  draft: QuickEntryDraft | null | undefined,
  text: string,
  userId?: string,
): Promise<AssistantTurnResult> {
  const products = await getProductsForAssistant(orgId);
  const turn = processQuickEntryTurn(draft, text, products);
  if (turn.action !== "save" || !turn.draft) return turn;

  const orderId = await saveQuickEntryOrder(orgId, turn.draft, products, userId);
  return { ...turn, savedOrderId: orderId };
}

async function saveQuickEntryOrder(
  orgId: string,
  draft: QuickEntryDraft,
  products: Awaited<ReturnType<typeof getProductsForAssistant>>,
  userId?: string,
): Promise<string> {
  const customer = await findOrCreateCustomerByName(orgId, draft.customerName ?? "Walk-in");
  const lines = resolveOrderLines(draft, products);

  const { withTransaction } = await import("../../apps/server/src/db");
  const { orders, order_items } = await import("../../apps/server/src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { publishEventTx } = await import("../eventBus");
  const { engine } = await import("../../apps/server/src/engine.wiring");

  const { orderId } = await withTransaction(async (tx) => {
    const result = await engine.placeOrder({
      orgId,
      customerId: customer.id,
      lines,
      paymentMethod: draft.paymentMethod,
    });
    const [createdOrder] = await tx.select().from(orders).where(eq(orders.id, result.orderId));
    const items = await tx.select().from(order_items).where(eq(order_items.order_id, result.orderId));

    await publishEventTx(
      tx,
      "OrderCreated",
      result.orderId,
      {
        order: {
          orderId: result.orderId,
          status: createdOrder?.status || "pending",
          customerId: createdOrder?.customer_id,
          total: parseFloat(createdOrder?.total || "0"),
          paymentMethod: createdOrder?.payment_method,
          items: items.map((item: typeof order_items.$inferSelect) => ({
            lineId: item.id,
            productId: item.product_id,
            qty: item.quantity,
            unitPrice: parseFloat(item.unit_price || "0"),
            lineTotal: parseFloat(item.total_price || "0"),
          })),
        },
      },
      { actor: userId ? { type: "user", id: userId } : { type: "system", id: "arcarna-voice" }, source: "assistant-voice" },
    );

    return { orderId: result.orderId };
  });

  if (draft.expenses.length > 0) {
    await storage.createOrderExpenses(
      orderId,
      draft.expenses.map((e) => ({ category: "other", description: e.label, amount: String(e.amount) })),
      orgId,
    );
  }

  return orderId;
}
