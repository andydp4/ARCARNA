/**
 * Card (link): Stripe Checkout links for a sale's awaiting card-link leg
 * (v1.2 Stripe links).
 *
 *  - The sale is recorded by the ordinary order route with its card-link leg
 *    `awaiting` (never counted as money taken).
 *  - The till asks for a link here: one Checkout Session for exactly the
 *    leg's amount, with our org, order, leg and link ids in its metadata.
 *  - Stripe's signed webhook (or the till's poll, which reads the session back
 *    from Stripe with our secret key) marks the leg paid with the Stripe
 *    payment reference. Nothing else is completed automatically: handing the
 *    goods over is still the Ops board's job.
 *  - Paid for a different amount or currency, or paid after the till switched
 *    to another tender: the leg is not touched and managers get a Signal.
 *  - Cancel expires the session at Stripe first, so a customer cannot pay a
 *    link the till has walked away from; then the till can take another tender.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db";
import {
  cardPaymentLinks,
  customers,
  orderPayments,
  orders,
  organizations,
  shifts,
  stripeWebhookEvents,
  whatsappConversations,
  type CardPaymentLink,
} from "@shared/schema";
import {
  CARD_LINK_METHOD,
  PAYMENT_STATUS_AWAITING,
  PAYMENT_STATUS_PAID,
  clampLinkMinutes,
  sessionMismatch,
  toMinorUnits,
  type CardLinkRetenderMethod,
} from "@shared/payments/cardLink";
import { isStripeConfigured } from "../stripe/config";
import {
  createCheckoutSession,
  expireCheckoutSession,
  paymentIntentId,
  retrieveCheckoutSession,
  type StripeCheckoutSession,
} from "../stripe/client";
import { notify } from "./signals";

type Executor = typeof db | any;

export class CardLinkError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = "CardLinkError";
  }
}

/** What the till sees. No customer contact, ever. */
export interface CardLinkView {
  orderId: string;
  /** The awaiting (or, once confirmed, paid) card-link leg. */
  leg: { id: string; amount: number; status: string; method: string; providerRef: string | null } | null;
  link: {
    id: string;
    status: string;
    url: string | null;
    amount: number;
    currency: string;
    expiresAt: string;
    paidAt: string | null;
  } | null;
}

function money(value: unknown): number {
  const n = parseFloat(String(value ?? "0"));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function shortCode(orderId: string): string {
  return orderId.slice(0, 8);
}

function viewOf(orderId: string, leg: typeof orderPayments.$inferSelect | null, link: CardPaymentLink | null): CardLinkView {
  return {
    orderId,
    leg: leg
      ? { id: leg.id, amount: money(leg.amount), status: leg.status, method: leg.method, providerRef: leg.providerRef ?? null }
      : null,
    link: link
      ? {
          id: link.id,
          status: link.status,
          url: link.status === "open" ? link.url : null,
          amount: money(link.amount),
          currency: link.currency,
          expiresAt: link.expiresAt.toISOString(),
          paidAt: link.paidAt ? link.paidAt.toISOString() : null,
        }
      : null,
  };
}

/** Orders among these with a card-link leg still waiting for Stripe — the Ops board's "Awaiting card payment". */
export async function awaitingCardOrderIds(orderIds: string[], client: Executor = db): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const rows: Array<{ orderId: string }> = await client
    .select({ orderId: orderPayments.orderId })
    .from(orderPayments)
    .where(and(inArray(orderPayments.orderId, orderIds), eq(orderPayments.status, PAYMENT_STATUS_AWAITING)));
  return new Set(rows.map((r) => r.orderId));
}

async function loadOrder(orgId: string, orderId: string, client: Executor = db) {
  const [order] = await client
    .select({ id: orders.id, status: orders.status, customerId: orders.customerId, total: orders.total })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)))
    .limit(1);
  return order ?? null;
}

/** The order's card-link leg: the awaiting one if any, else the latest paid one. */
async function loadCardLeg(orgId: string, orderId: string, client: Executor = db, lock = false) {
  let q = client
    .select()
    .from(orderPayments)
    .where(
      and(
        eq(orderPayments.orgId, orgId),
        eq(orderPayments.orderId, orderId),
        eq(orderPayments.method, CARD_LINK_METHOD),
      ),
    )
    .orderBy(desc(orderPayments.createdAt));
  if (lock) q = q.for("update");
  const legs: Array<typeof orderPayments.$inferSelect> = await q;
  return legs.find((l) => l.status === PAYMENT_STATUS_AWAITING) ?? legs[0] ?? null;
}

async function latestLink(orgId: string, orderId: string, client: Executor = db): Promise<CardPaymentLink | null> {
  const [link] = await client
    .select()
    .from(cardPaymentLinks)
    .where(and(eq(cardPaymentLinks.orgId, orgId), eq(cardPaymentLinks.orderId, orderId)))
    .orderBy(desc(cardPaymentLinks.createdAt))
    .limit(1);
  return link ?? null;
}

async function orgCurrency(orgId: string, client: Executor = db): Promise<string> {
  const [org] = await client
    .select({ currency: organizations.currency })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const c = String(org?.currency ?? "GBP").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : "GBP";
}

/** An open link whose time is up is expired, whether or not Stripe has said so yet. */
async function closeIfTimedOut(link: CardPaymentLink | null, now: Date, client: Executor = db): Promise<CardPaymentLink | null> {
  if (!link || link.status !== "open" || link.expiresAt.getTime() > now.getTime()) return link;
  const [row] = await client
    .update(cardPaymentLinks)
    .set({ status: "expired", closedReason: "Timed out", updatedAt: now })
    .where(and(eq(cardPaymentLinks.id, link.id), eq(cardPaymentLinks.status, "open")))
    .returning();
  return row ?? { ...link, status: "expired" };
}

export async function getCardLinkState(
  orgId: string,
  orderId: string,
  options: { refreshFromStripe?: boolean; now?: Date } = {},
): Promise<CardLinkView> {
  const now = options.now ?? new Date();
  const order = await loadOrder(orgId, orderId);
  if (!order) throw new CardLinkError(404, "ORDER_NOT_FOUND", "Order not found");
  let link = await latestLink(orgId, orderId);
  // If Stripe's webhook has not arrived (or is not reaching us), ask Stripe.
  // The answer comes over our own authenticated call, so it is as good as a
  // signed webhook.
  if (options.refreshFromStripe && link?.status === "open" && link.sessionId && isStripeConfigured()) {
    const got = await retrieveCheckoutSession(link.sessionId);
    if (got.ok) {
      if (got.value.status === "complete" && got.value.payment_status === "paid") {
        const settled = await db.transaction((tx: Executor) => settleSessionTx(tx, got.value, "poll"));
        await retireSessions(settled.retireSessionIds);
      } else if (got.value.status === "expired") {
        await markLinkClosed(link.id, "expired", "Stripe expired it");
      }
      link = await latestLink(orgId, orderId);
    }
  }
  link = await closeIfTimedOut(link, now);
  const leg = await loadCardLeg(orgId, orderId);
  return viewOf(orderId, leg, link);
}

type RetireOutcome =
  | { kind: "retired" }
  | { kind: "paid"; session: StripeCheckoutSession }
  | { kind: "unreachable" };

/**
 * Makes a session unpayable at Stripe. Stripe refuses to expire a session that
 * is already complete (or being paid), and expireCheckoutSession reports that
 * as a result rather than throwing, so ask Stripe what happened instead of
 * assuming the link is dead.
 */
async function retireSessionAtStripe(sessionId: string): Promise<RetireOutcome> {
  const expired = await expireCheckoutSession(sessionId).catch(() => null);
  if (expired?.ok) return { kind: "retired" };
  const got = await retrieveCheckoutSession(sessionId).catch(() => null);
  if (got?.ok) {
    if (got.value.status === "expired") return { kind: "retired" };
    if (got.value.status === "complete" && got.value.payment_status === "paid") return { kind: "paid", session: got.value };
  }
  return { kind: "unreachable" };
}

/** Best effort, after a commit: other links left open on a leg that is now paid. */
async function retireSessions(sessionIds: string[] | undefined): Promise<void> {
  if (!sessionIds?.length || !isStripeConfigured()) return;
  for (const id of sessionIds) {
    // A refusal here means the customer is paying the spare link right now;
    // if they finish, the webhook raises "Paid twice" for a person to refund.
    await expireCheckoutSession(id).catch(() => null);
  }
}

async function markLinkClosed(linkId: string, status: "expired" | "cancelled", reason: string, client: Executor = db) {
  await client
    .update(cardPaymentLinks)
    .set({ status, closedReason: reason, updatedAt: new Date() })
    .where(and(eq(cardPaymentLinks.id, linkId), eq(cardPaymentLinks.status, "open")));
}

export async function createCardLink(params: {
  orgId: string;
  orderId: string;
  userId: string | null;
  successUrl: string;
  minutes?: number;
  now?: Date;
}): Promise<CardLinkView> {
  const { orgId, orderId } = params;
  const now = params.now ?? new Date();
  if (!isStripeConfigured()) {
    throw new CardLinkError(409, "CARD_LINK_NOT_SET_UP", "Card (link) is not set up. Choose another way to pay.");
  }
  const order = await loadOrder(orgId, orderId);
  if (!order) throw new CardLinkError(404, "ORDER_NOT_FOUND", "Order not found");
  const leg = await loadCardLeg(orgId, orderId);
  if (!leg || leg.status !== PAYMENT_STATUS_AWAITING) {
    throw new CardLinkError(409, "CARD_LINK_NOTHING_AWAITING", "Nothing on this order is waiting for a card link.");
  }

  // A double tap, or the till reopening the screen: the link already made.
  const existing = await closeIfTimedOut(await latestLink(orgId, orderId), now);
  if (existing?.status === "open" && existing.paymentId === leg.id) {
    if (existing.expiresAt.getTime() - now.getTime() > 60_000) return viewOf(orderId, leg, existing);
    // About to lapse: retire it at Stripe before making a fresh one. If Stripe
    // will not (the customer is paying it now), a second link would let them
    // pay twice, so none is made.
    if (existing.sessionId) {
      const retired = await retireSessionAtStripe(existing.sessionId);
      if (retired.kind === "paid") {
        const settled = await db.transaction((tx: Executor) => settleSessionTx(tx, retired.session, "poll"));
        await retireSessions(settled.retireSessionIds);
        return getCardLinkState(orgId, orderId);
      }
      if (retired.kind === "unreachable") {
        throw new CardLinkError(
          409,
          "CARD_LINK_STILL_PAYABLE",
          "The customer may be paying the current link. Wait a moment, then try again.",
        );
      }
    }
    await markLinkClosed(existing.id, "expired", "Replaced by a new link");
  }

  const amount = money(leg.amount);
  const currency = await orgCurrency(orgId);
  const linkId = randomUUID();
  const expiresAt = new Date(now.getTime() + clampLinkMinutes(params.minutes) * 60_000);
  const created = await createCheckoutSession({
    amountMinor: toMinorUnits(amount),
    currency,
    description: `Order ${shortCode(orderId)}`,
    orgId,
    orderId,
    linkId,
    paymentId: leg.id,
    expiresAt,
    successUrl: params.successUrl,
  });
  if (!created.ok) {
    throw new CardLinkError(502, "CARD_LINK_STRIPE_REFUSED", `Stripe could not make the link: ${created.message}`);
  }
  const session = created.value;

  try {
    const link = await db.transaction(async (tx: Executor) => {
      const [current] = await tx.select().from(orderPayments).where(eq(orderPayments.id, leg.id)).for("update");
      if (!current || current.status !== PAYMENT_STATUS_AWAITING) {
        throw new CardLinkError(409, "CARD_LINK_NOTHING_AWAITING", "This payment is no longer waiting for a card link.");
      }
      const [row] = await tx
        .insert(cardPaymentLinks)
        .values({
          id: linkId,
          orgId,
          orderId,
          paymentId: leg.id,
          provider: "stripe",
          sessionId: session.id,
          url: session.url,
          amount: amount.toFixed(2),
          currency,
          status: "open",
          expiresAt,
          createdByUserId: params.userId,
        })
        .returning();
      return row as CardPaymentLink;
    });
    return viewOf(orderId, leg, link);
  } catch (error) {
    // The session exists at Stripe but not here: expire it so nobody can pay
    // a link arcarna is not watching.
    await expireCheckoutSession(session.id).catch(() => null);
    if (error instanceof CardLinkError) throw error;
    // Another tap won the race for the one open link on this leg.
    const winner = await latestLink(orgId, orderId);
    if (winner?.status === "open") return viewOf(orderId, leg, winner);
    throw error;
  }
}

export async function cancelCardLink(orgId: string, orderId: string): Promise<CardLinkView> {
  const link = await closeIfTimedOut(await latestLink(orgId, orderId), new Date());
  if (link?.status === "open") {
    if (link.sessionId) {
      const retired = await retireSessionAtStripe(link.sessionId);
      if (retired.kind === "paid") {
        const settled = await db.transaction((tx: Executor) => settleSessionTx(tx, retired.session, "poll"));
        await retireSessions(settled.retireSessionIds);
        throw new CardLinkError(409, "CARD_LINK_ALREADY_PAID", "The customer has already paid this link.");
      }
      if (retired.kind === "unreachable") {
        throw new CardLinkError(502, "CARD_LINK_STRIPE_UNREACHABLE", "Could not cancel the link at Stripe. Try again.");
      }
    }
    await markLinkClosed(link.id, "cancelled", "Cancelled at the till");
  }
  return getCardLinkState(orgId, orderId);
}

/**
 * Before an order is deleted: every link still open on it is made unpayable at
 * Stripe, so a customer cannot pay for a sale that no longer exists. Refused
 * (nothing deleted) if the customer has already paid, or Stripe cannot be
 * reached to confirm the link is dead.
 */
export async function retireOrderCardLinks(orgId: string | null, orderId: string): Promise<void> {
  const conds = [eq(cardPaymentLinks.orderId, orderId), eq(cardPaymentLinks.status, "open")];
  if (orgId) conds.push(eq(cardPaymentLinks.orgId, orgId));
  const open: CardPaymentLink[] = await db.select().from(cardPaymentLinks).where(and(...conds));
  for (const link of open) {
    if (link.sessionId && isStripeConfigured()) {
      const retired = await retireSessionAtStripe(link.sessionId);
      if (retired.kind === "paid") {
        const settled = await db.transaction((tx: Executor) => settleSessionTx(tx, retired.session, "poll"));
        await retireSessions(settled.retireSessionIds);
        throw new CardLinkError(
          409,
          "CARD_LINK_ALREADY_PAID",
          "The customer has already paid this order's card link, so it cannot be deleted.",
        );
      }
      if (retired.kind === "unreachable") {
        throw new CardLinkError(
          502,
          "CARD_LINK_STRIPE_UNREACHABLE",
          "Could not cancel this order's card link at Stripe, so it was not deleted. Try again.",
        );
      }
    }
    await markLinkClosed(link.id, "cancelled", "Order deleted");
  }
}

/**
 * The customer paid another way after all: the awaiting card-link leg becomes
 * a paid leg of that tender. Refused while a link is still open — cancel it
 * first, so the customer cannot pay twice.
 */
export async function retenderCardLink(
  orgId: string,
  orderId: string,
  method: CardLinkRetenderMethod,
): Promise<CardLinkView> {
  const now = new Date();
  await closeIfTimedOut(await latestLink(orgId, orderId), now);
  await db.transaction(async (tx: Executor) => {
    const leg = await loadCardLeg(orgId, orderId, tx, true);
    if (!leg || leg.status !== PAYMENT_STATUS_AWAITING) {
      throw new CardLinkError(409, "CARD_LINK_NOTHING_AWAITING", "Nothing on this order is waiting for a card link.");
    }
    // The re-tendered money lands in the sale's own shift. Once that shift is
    // closed and counted, it would change a Z-report already reconciled and
    // miss the drawer that actually took it.
    const [order] = await tx
      .select({ shiftId: orders.shiftId })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)))
      .limit(1);
    if (order?.shiftId) {
      const [shift] = await tx.select({ status: shifts.status }).from(shifts).where(eq(shifts.id, order.shiftId)).limit(1);
      // A reopened shift is being recounted, so the payment still lands before its count.
      if (shift && shift.status !== "open" && shift.status !== "reopened") {
        throw new CardLinkError(
          409,
          "CARD_LINK_SHIFT_CLOSED",
          "The shift this sale was taken on is closed and counted. A manager can reopen that shift to record how it was paid.",
        );
      }
    }
    const [open] = await tx
      .select({ id: cardPaymentLinks.id })
      .from(cardPaymentLinks)
      .where(and(eq(cardPaymentLinks.paymentId, leg.id), eq(cardPaymentLinks.status, "open")))
      .limit(1);
    if (open) {
      throw new CardLinkError(409, "CARD_LINK_STILL_OPEN", "Cancel the card link first, so the customer cannot pay twice.");
    }
    await tx
      .update(orderPayments)
      .set({ method, status: PAYMENT_STATUS_PAID, paidAt: now, provider: null, providerRef: null })
      .where(eq(orderPayments.id, leg.id));
    // The order's label follows a single tender; a split stays "split".
    const legs: Array<{ method: string }> = await tx
      .select({ method: orderPayments.method })
      .from(orderPayments)
      .where(eq(orderPayments.orderId, orderId));
    const methods = new Set(legs.map((l) => l.method));
    if (methods.size === 1) {
      await tx.update(orders).set({ paymentMethod: method, updatedAt: now }).where(eq(orders.id, orderId));
    }
  });
  return getCardLinkState(orgId, orderId);
}

export type StripeEventOutcome =
  | "paid"
  | "already_paid"
  | "mismatch"
  | "paid_after_retender"
  | "unknown_session"
  | "expired"
  | "awaiting_async"
  | "ignored"
  | "duplicate";

export interface StripeEventResult {
  outcome: StripeEventOutcome;
  orgId: string | null;
  orderId: string | null;
  /** Other sessions still payable for a leg now paid: expire them at Stripe once committed. */
  retireSessionIds?: string[];
}

/**
 * Marks a paid session's leg paid — or refuses to and tells managers why.
 * Idempotent: a link already paid is left alone.
 */
export async function settleSessionTx(
  tx: Executor,
  session: StripeCheckoutSession,
  source: "webhook" | "poll",
): Promise<StripeEventResult> {
  const [link]: CardPaymentLink[] = await tx
    .select()
    .from(cardPaymentLinks)
    .where(eq(cardPaymentLinks.sessionId, session.id))
    .for("update");
  const metaOrg = session.metadata?.org_id ?? null;
  if (!link) {
    // Money taken for a link arcarna no longer has (its order was deleted).
    // Our own metadata names the org; a stranger's session names nothing.
    if (metaOrg && /^[0-9a-f-]{36}$/i.test(metaOrg)) {
      const [org] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, metaOrg)).limit(1);
      if (org) {
        await notify(
          {
            orgId: metaOrg,
            source: "card_link",
            severity: "error",
            title: "Card payment for an order arcarna no longer has",
            message: `Stripe took ${formatMinor(session.amount_total, session.currency)} (payment ${paymentIntentId(session) ?? session.id}) for order ${shortCode(session.metadata?.order_id ?? "unknown")}, which is no longer on file. Check it in Stripe and refund it if the sale did not happen.`,
            metadata: { sessionId: session.id, paymentIntent: paymentIntentId(session) },
          },
          tx,
        );
      }
    }
    return { outcome: "unknown_session", orgId: metaOrg, orderId: session.metadata?.order_id ?? null };
  }
  if (link.status === "paid") return { outcome: "already_paid", orgId: link.orgId, orderId: link.orderId };

  const now = new Date();
  const pi = paymentIntentId(session);
  const mismatch = sessionMismatch(
    { amount: money(link.amount), currency: link.currency, orderId: link.orderId },
    { amountMinor: session.amount_total, currency: session.currency, orderId: session.metadata?.order_id },
  );
  if (mismatch) {
    await tx
      .update(cardPaymentLinks)
      .set({ status: "mismatch", closedReason: mismatch, paymentIntentId: pi, updatedAt: now })
      .where(eq(cardPaymentLinks.id, link.id));
    await notify(
      {
        orgId: link.orgId,
        source: "card_link",
        severity: "error",
        title: "Card link payment does not match the sale",
        message: `${mismatch}. Order ${shortCode(link.orderId)} is still awaiting card payment. Check payment ${pi ?? session.id} in Stripe.`,
        metadata: { orderId: link.orderId, linkId: link.id, sessionId: session.id, paymentIntent: pi, source },
      },
      tx,
    );
    return { outcome: "mismatch", orgId: link.orgId, orderId: link.orderId };
  }

  const [leg] = await tx.select().from(orderPayments).where(eq(orderPayments.id, link.paymentId)).for("update");
  await tx
    .update(cardPaymentLinks)
    .set({ status: "paid", paymentIntentId: pi, paidAt: now, updatedAt: now })
    .where(eq(cardPaymentLinks.id, link.id));
  if (!leg || leg.status !== PAYMENT_STATUS_AWAITING || leg.method !== CARD_LINK_METHOD) {
    // The till took the money another way, then the customer paid the link
    // anyway. Nothing is recorded twice; a person refunds one of them.
    await notify(
      {
        orgId: link.orgId,
        source: "card_link",
        severity: "error",
        title: "Paid twice: card link after another payment",
        message: `Order ${shortCode(link.orderId)} was paid by card link (${formatMinor(session.amount_total, session.currency)}, payment ${pi ?? session.id}) after the till recorded another payment for it. Refund one of them.`,
        metadata: { orderId: link.orderId, linkId: link.id, paymentIntent: pi, source },
      },
      tx,
    );
    return { outcome: "paid_after_retender", orgId: link.orgId, orderId: link.orderId };
  }
  await tx
    .update(orderPayments)
    .set({ status: PAYMENT_STATUS_PAID, provider: "stripe", providerRef: pi ?? session.id, paidAt: now })
    .where(eq(orderPayments.id, leg.id));
  // An older link was paid while a newer one is still open for the same leg:
  // close the newer one, so paying it too is flagged rather than recorded.
  const spare: Array<{ sessionId: string | null }> = await tx
    .update(cardPaymentLinks)
    .set({ status: "cancelled", closedReason: "Paid by another link", updatedAt: now })
    .where(
      and(
        eq(cardPaymentLinks.paymentId, leg.id),
        eq(cardPaymentLinks.status, "open"),
        ne(cardPaymentLinks.id, link.id),
      ),
    )
    .returning({ sessionId: cardPaymentLinks.sessionId });
  const retireSessionIds = spare.map((r) => r.sessionId).filter((id): id is string => !!id);
  return { outcome: "paid", orgId: link.orgId, orderId: link.orderId, retireSessionIds };
}

function formatMinor(amount: number | null | undefined, currency: string | null | undefined): string {
  const cur = String(currency ?? "").toUpperCase();
  const value = typeof amount === "number" ? (amount / 100).toFixed(2) : "?";
  return cur === "GBP" ? `£${value}` : `${value} ${cur}`.trim();
}

export interface StripeEvent {
  id: string;
  type: string;
  data?: { object?: StripeCheckoutSession };
}

/**
 * One verified Stripe event, applied once. The event id is recorded in the
 * same transaction as its effect, so a redelivery is a no-op and a failure
 * part way leaves nothing recorded for Stripe's retry to trip over.
 */
export async function applyStripeEvent(event: StripeEvent): Promise<StripeEventResult> {
  const result = await applyStripeEventTx(event);
  await retireSessions(result.retireSessionIds);
  return result;
}

async function applyStripeEventTx(event: StripeEvent): Promise<StripeEventResult> {
  return db.transaction(async (tx: Executor) => {
    const inserted = await tx
      .insert(stripeWebhookEvents)
      .values({ eventId: event.id, type: String(event.type).slice(0, 100), outcome: "received" })
      .onConflictDoNothing()
      .returning({ eventId: stripeWebhookEvents.eventId });
    if (inserted.length === 0) return { outcome: "duplicate" as const, orgId: null, orderId: null };

    const session = event.data?.object;
    let result: StripeEventResult = { outcome: "ignored", orgId: null, orderId: null };
    if (session && session.id) {
      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded":
          result =
            session.payment_status === "paid"
              ? await settleSessionTx(tx, session, "webhook")
              : { outcome: "awaiting_async", orgId: session.metadata?.org_id ?? null, orderId: session.metadata?.order_id ?? null };
          break;
        case "checkout.session.expired":
        case "checkout.session.async_payment_failed": {
          const [link]: CardPaymentLink[] = await tx
            .select()
            .from(cardPaymentLinks)
            .where(eq(cardPaymentLinks.sessionId, session.id))
            .limit(1);
          if (link) {
            await markLinkClosed(
              link.id,
              "expired",
              event.type === "checkout.session.expired" ? "Stripe expired it" : "The payment failed",
              tx,
            );
            result = { outcome: "expired", orgId: link.orgId, orderId: link.orderId };
          }
          break;
        }
      }
    }
    await tx.update(stripeWebhookEvents).set({ outcome: result.outcome }).where(eq(stripeWebhookEvents.eventId, event.id));
    return result;
  });
}

/**
 * Sends the open link to the order's customer on WhatsApp with the approved
 * `payment_reminder` template. The number is looked up here and never leaves
 * the server: a cashier can send the link, not read the customer's contact.
 */
export async function sendCardLinkByWhatsapp(orgId: string, orderId: string): Promise<{ conversationId: string | null; messageId: string | null }> {
  const { getWhatsappConfig, canSendWhatsapp } = await import("../whatsapp/config");
  const { sendTemplateMessage } = await import("../whatsapp/client");
  const { toWhatsappNumber } = await import("../whatsapp/phone");
  const store = await import("../whatsapp/store");
  const { checkTemplateConsent } = await import("@shared/marketingConsent");

  const cfg = getWhatsappConfig();
  if (!canSendWhatsapp(cfg)) throw new CardLinkError(409, "WHATSAPP_NOT_SET_UP", "WhatsApp is not set up.");
  const order = await loadOrder(orgId, orderId);
  if (!order) throw new CardLinkError(404, "ORDER_NOT_FOUND", "Order not found");
  const link = await closeIfTimedOut(await latestLink(orgId, orderId), new Date());
  if (!link || link.status !== "open" || !link.url) {
    throw new CardLinkError(409, "CARD_LINK_NOT_OPEN", "There is no open card link on this order to send.");
  }
  if (!order.customerId) {
    throw new CardLinkError(422, "CARD_LINK_NO_CUSTOMER", "Pick the customer on the sale to send them the link.");
  }
  const [customer] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.id, order.customerId), eq(customers.orgId, orgId)))
    .limit(1);
  const [conversation] = await db
    .select({ id: whatsappConversations.id, waId: whatsappConversations.waId })
    .from(whatsappConversations)
    .where(and(eq(whatsappConversations.orgId, orgId), eq(whatsappConversations.customerId, order.customerId)))
    .orderBy(desc(whatsappConversations.lastMessageAt))
    .limit(1);
  // The number is read through the customer view's one named phone read and
  // only ever goes to WhatsApp — it is never returned to the till (PRV-03).
  const { readCustomerPhone } = await import("./customerView");
  const phone = conversation?.waId || !customer ? null : await readCustomerPhone(orgId, customer.id);
  const waId = conversation?.waId ?? (phone ? toWhatsappNumber(phone, cfg.defaultCountryCode) : "");
  if (!waId) {
    throw new CardLinkError(422, "CARD_LINK_NO_PHONE", "This customer has no phone number for WhatsApp.");
  }

  const templateName = "payment_reminder";
  const language = "en_GB";
  const template = await store.getTemplate(orgId, templateName, language);
  if (template && template.status !== "APPROVED" && template.status !== "LOCAL") {
    throw new CardLinkError(422, "WHATSAPP_TEMPLATE_NOT_APPROVED", `The "${templateName}" WhatsApp template is not approved.`);
  }
  const consent = checkTemplateConsent(template, null);
  if (!consent.ok) throw new CardLinkError(422, consent.code ?? "WHATSAPP_CONSENT", consent.message ?? "Consent needed");

  const firstName = String(customer?.name ?? "").trim().split(/\s+/)[0] || "there";
  const amount = formatMinor(toMinorUnits(money(link.amount)), link.currency);
  const result = await sendTemplateMessage(waId, templateName, language, [firstName, amount, link.url], cfg);
  if (!result.ok) {
    throw new CardLinkError(502, "WHATSAPP_SEND_FAILED", result.error ?? "WhatsApp did not send the message.");
  }
  if (conversation) {
    await store.insertOutboundMessage({
      orgId,
      conversationId: conversation.id,
      whatsappMessageId: result.messageId,
      body: `[template: ${templateName}] Card payment link for order ${shortCode(orderId)} (${amount})`,
      status: "sent",
    });
  }
  return { conversationId: conversation?.id ?? null, messageId: result.messageId ?? null };
}
