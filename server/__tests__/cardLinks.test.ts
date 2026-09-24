/**
 * Card (link) against a real database (v1.2 Stripe links).
 *
 *  - Stripe's webhook: a good signature marks the awaiting leg paid with the
 *    Stripe reference; a bad one, or a genuine one replayed later, is refused;
 *    the same event delivered twice is applied once.
 *  - A payment for a different amount is not marked paid; managers get a Signal.
 *  - An awaiting leg is not money taken: the order cannot be completed, and
 *    the Ops board says "Awaiting card payment", until Stripe confirms.
 *  - Cancel, then another tender; a link paid after that is flagged, not
 *    recorded twice.
 *  - Making a link sends Stripe exactly the leg's amount, the org's currency
 *    and our ids (Stripe itself is stubbed; nothing leaves the machine).
 *
 * Excluded from the no-DB run in vitest.config.ts; in CI's unit-db job by name.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  cardPaymentLinks,
  orderEvents,
  orderPayments,
  orders,
  organizations,
  orgNotifications,
  stripeWebhookEvents,
} from "@shared/schema";
import { signStripePayload } from "../stripe/verify";
import { registerCardLinkPublicRoutes } from "../routes/cardLinks";
import {
  applyStripeEvent,
  awaitingCardOrderIds,
  cancelCardLink,
  createCardLink,
  retenderCardLink,
} from "../services/cardLinks";
import { runOrderTransition } from "../services/orderTransitions";
import { getOpsBoardOrder } from "../services/opsBoard";

const WEBHOOK_SECRET = "whsec_test_card_links";
const SUFFIX = Date.now().toString(36);
let orgId: string;
const eventIds: string[] = [];

process.env.STRIPE_SECRET_KEY = "sk_test_card_links";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

function app() {
  const a = express();
  a.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      },
    }),
  );
  registerCardLinkPublicRoutes(a);
  return a;
}

async function makeSale(amount: string, opts: { withLink?: boolean; sessionId?: string | null } = {}) {
  const [order] = await db.insert(orders).values({ orgId, total: amount, paymentMethod: "card_link" }).returning();
  const [leg] = await db
    .insert(orderPayments)
    .values({ orgId, orderId: order.id, method: "card_link", amount, status: "awaiting" })
    .returning();
  let link: typeof cardPaymentLinks.$inferSelect | null = null;
  if (opts.withLink !== false) {
    [link] = await db
      .insert(cardPaymentLinks)
      .values({
        orgId,
        orderId: order.id,
        paymentId: leg.id,
        sessionId: opts.sessionId === undefined ? `cs_test_${SUFFIX}_${Math.random().toString(36).slice(2)}` : opts.sessionId,
        url: "https://checkout.stripe.com/c/pay/test",
        amount,
        currency: "GBP",
        status: "open",
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })
      .returning();
  }
  return { orderId: order.id, legId: leg.id, link };
}

function paidEvent(sessionId: string, orderId: string, amountMinor: number, currency = "gbp") {
  const id = `evt_${SUFFIX}_${Math.random().toString(36).slice(2)}`;
  eventIds.push(id);
  return {
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        url: null,
        status: "complete",
        payment_status: "paid",
        amount_total: amountMinor,
        currency,
        payment_intent: `pi_${SUFFIX}`,
        expires_at: null,
        client_reference_id: orderId,
        metadata: { org_id: orgId, order_id: orderId },
      },
    },
  };
}

function post(event: unknown, timestamp = Math.floor(Date.now() / 1000), secret = WEBHOOK_SECRET) {
  const body = JSON.stringify(event);
  return request(app())
    .post("/api/stripe/webhook")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", signStripePayload(body, secret, timestamp))
    .send(body);
}

async function leg(legId: string) {
  const [row] = await db.select().from(orderPayments).where(eq(orderPayments.id, legId));
  return row;
}

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `card-links-${SUFFIX}` }).returning();
  orgId = org.id;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (!orgId) return;
  for (const id of eventIds) await db.delete(stripeWebhookEvents).where(eq(stripeWebhookEvents.eventId, id));
  await db.delete(orgNotifications).where(eq(orgNotifications.orgId, orgId));
  await db.delete(cardPaymentLinks).where(eq(cardPaymentLinks.orgId, orgId));
  await db.delete(orderPayments).where(eq(orderPayments.orgId, orgId));
  await db.delete(orderEvents).where(eq(orderEvents.orgId, orgId));
  await db.delete(orders).where(eq(orders.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("Stripe webhook", () => {
  it("a good signature marks the leg paid with Stripe's reference", async () => {
    const sale = await makeSale("20.00");
    const res = await post(paidEvent(sale.link!.sessionId!, sale.orderId, 2000));
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("paid");
    const row = await leg(sale.legId);
    expect(row.status).toBe("paid");
    expect(row.provider).toBe("stripe");
    expect(row.providerRef).toBe(`pi_${SUFFIX}`);
    const [link] = await db.select().from(cardPaymentLinks).where(eq(cardPaymentLinks.id, sale.link!.id));
    expect(link.status).toBe("paid");
    // Nothing else is completed automatically.
    const [order] = await db.select().from(orders).where(eq(orders.id, sale.orderId));
    expect(order.status).not.toBe("completed");
  });

  it("a bad signature is refused and nothing is recorded", async () => {
    const sale = await makeSale("7.50");
    const event = paidEvent(sale.link!.sessionId!, sale.orderId, 750);
    const res = await post(event, Math.floor(Date.now() / 1000), "whsec_someone_else");
    expect(res.status).toBe(400);
    expect((await leg(sale.legId)).status).toBe("awaiting");
    const seen = await db.select().from(stripeWebhookEvents).where(eq(stripeWebhookEvents.eventId, event.id));
    expect(seen).toHaveLength(0);
  });

  it("a genuine request replayed after the tolerance is refused", async () => {
    const sale = await makeSale("7.50");
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
    const res = await post(paidEvent(sale.link!.sessionId!, sale.orderId, 750), tenMinutesAgo);
    expect(res.status).toBe(400);
    expect((await leg(sale.legId)).status).toBe("awaiting");
  });

  it("the same event delivered twice is applied once", async () => {
    const sale = await makeSale("12.00");
    const event = paidEvent(sale.link!.sessionId!, sale.orderId, 1200);
    const first = await post(event);
    const second = await post(event);
    expect(first.body.outcome).toBe("paid");
    expect(second.status).toBe(200);
    expect(second.body.outcome).toBe("duplicate");
    const rows = await db.select().from(stripeWebhookEvents).where(eq(stripeWebhookEvents.eventId, event.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("paid");
  });

  it("a payment for the wrong amount is not marked paid and managers get a Signal", async () => {
    const sale = await makeSale("20.00");
    const res = await post(paidEvent(sale.link!.sessionId!, sale.orderId, 1500));
    expect(res.body.outcome).toBe("mismatch");
    expect((await leg(sale.legId)).status).toBe("awaiting");
    const [link] = await db.select().from(cardPaymentLinks).where(eq(cardPaymentLinks.id, sale.link!.id));
    expect(link.status).toBe("mismatch");
    const signals = await db
      .select()
      .from(orgNotifications)
      .where(and(eq(orgNotifications.orgId, orgId), eq(orgNotifications.source, "card_link")));
    expect(signals.some((s) => s.message.includes(sale.orderId.slice(0, 8)))).toBe(true);
  });

  it("a payment in the wrong currency is not marked paid", async () => {
    const sale = await makeSale("20.00");
    const res = await post(paidEvent(sale.link!.sessionId!, sale.orderId, 2000, "eur"));
    expect(res.body.outcome).toBe("mismatch");
    expect((await leg(sale.legId)).status).toBe("awaiting");
  });

  it("an expired session closes the link and leaves the leg awaiting", async () => {
    const sale = await makeSale("9.00");
    const id = `evt_${SUFFIX}_exp`;
    eventIds.push(id);
    const res = await applyStripeEvent({
      id,
      type: "checkout.session.expired",
      data: { object: { ...paidEvent(sale.link!.sessionId!, sale.orderId, 900).data.object, status: "expired", payment_status: "unpaid" } },
    });
    expect(res.outcome).toBe("expired");
    const [link] = await db.select().from(cardPaymentLinks).where(eq(cardPaymentLinks.id, sale.link!.id));
    expect(link.status).toBe("expired");
    expect((await leg(sale.legId)).status).toBe("awaiting");
  });
});

describe("an awaiting leg is not money taken", () => {
  it("blocks completion and shows on the board until Stripe confirms", async () => {
    const sale = await makeSale("15.00");
    expect((await awaitingCardOrderIds([sale.orderId])).has(sale.orderId)).toBe(true);
    expect((await getOpsBoardOrder(orgId, sale.orderId))!.awaitingCardPayment).toBe(true);

    await expect(
      runOrderTransition({ orgId, orderId: sale.orderId, actor: { userId: "sam", role: "CASHIER" }, input: { action: "complete" } }),
    ).rejects.toMatchObject({ code: "ORDER_AWAITING_CARD_PAYMENT" });

    await post(paidEvent(sale.link!.sessionId!, sale.orderId, 1500));
    expect((await getOpsBoardOrder(orgId, sale.orderId))!.awaitingCardPayment).toBe(false);
    const done = await runOrderTransition({
      orgId,
      orderId: sale.orderId,
      actor: { userId: "sam", role: "CASHIER" },
      input: { action: "complete" },
    });
    expect(done.order.status).toBe("completed");
  });
});

describe("cancel and take another tender", () => {
  it("refuses another tender while the link is open, then records it once cancelled", async () => {
    const sale = await makeSale("11.00", { sessionId: null });
    await expect(retenderCardLink(orgId, sale.orderId, "cash")).rejects.toMatchObject({ code: "CARD_LINK_STILL_OPEN" });

    const cancelled = await cancelCardLink(orgId, sale.orderId);
    expect(cancelled.link?.status).toBe("cancelled");
    const view = await retenderCardLink(orgId, sale.orderId, "cash");
    expect(view.leg).toBeNull(); // no card-link leg any more
    const row = await leg(sale.legId);
    expect(row.method).toBe("cash");
    expect(row.status).toBe("paid");
    const [order] = await db.select().from(orders).where(eq(orders.id, sale.orderId));
    expect(order.paymentMethod).toBe("cash");
  });

  it("a link paid after the till took cash is flagged, not recorded twice", async () => {
    const sale = await makeSale("8.00");
    await db.update(cardPaymentLinks).set({ status: "cancelled" }).where(eq(cardPaymentLinks.id, sale.link!.id));
    await retenderCardLink(orgId, sale.orderId, "cash");
    const res = await post(paidEvent(sale.link!.sessionId!, sale.orderId, 800));
    expect(res.body.outcome).toBe("paid_after_retender");
    const row = await leg(sale.legId);
    expect(row.method).toBe("cash");
    expect(row.provider).toBeNull();
  });
});

describe("making a link", () => {
  it("asks Stripe for exactly the leg's amount with our ids, and a double tap returns the same link", async () => {
    const sale = await makeSale("23.45", { withLink: false });
    const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: String(init.body ?? ""), headers: init.headers as Record<string, string> });
        return new Response(
          JSON.stringify({
            id: `cs_test_${SUFFIX}_made`,
            url: "https://checkout.stripe.com/c/pay/made",
            status: "open",
            payment_status: "unpaid",
            amount_total: 2345,
            currency: "gbp",
            payment_intent: null,
            expires_at: null,
            client_reference_id: sale.orderId,
            metadata: {},
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    const view = await createCardLink({ orgId, orderId: sale.orderId, userId: "sam", successUrl: "https://shop.example/paid" });
    expect(view.link?.url).toBe("https://checkout.stripe.com/c/pay/made");
    expect(view.link?.amount).toBe(23.45);
    expect(calls).toHaveLength(1);
    const body = new URLSearchParams(calls[0].body);
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("2345");
    expect(body.get("line_items[0][price_data][currency]")).toBe("gbp");
    expect(body.get("metadata[order_id]")).toBe(sale.orderId);
    expect(body.get("metadata[org_id]")).toBe(orgId);
    expect(body.get("mode")).toBe("payment");
    expect(calls[0].headers["Stripe-Version"]).toBeTruthy();

    const again = await createCardLink({ orgId, orderId: sale.orderId, userId: "sam", successUrl: "https://shop.example/paid" });
    expect(again.link?.id).toBe(view.link?.id);
    expect(calls).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
