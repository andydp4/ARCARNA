/**
 * Price guard at the till, server side (v1.2 Phase 4: PRC-02, PRC-04, CMP-05).
 *
 * Warn and confirm, never block. The till asks the cashier for a reason when a
 * keyed price is below the minimum; this records it with the sale. The rules
 * the till shows are re-run here on what was actually charged
 * (shared/pricing/priceGuard.ts), so a sale that arrives without the till's
 * confirmation — an old till, an API caller, a till that skipped it — is
 * stored as unconfirmed at the higher severity rather than refused.
 *
 * The order-level below-cost check also runs here, after all discounts. It
 * tells managers and admins; the cashier is never a recipient (owner Q4).
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { allowedUsers, organizations, orgNotifications, priceGuardOrders } from "@shared/schema";
import { REPEAT_THRESHOLD, REPEAT_WINDOW_DAYS } from "@shared/review/exceptions";
import {
  confirmationProblem,
  evaluateOrderGuard,
  orderRefOf,
  priceGuardSignalLine,
  readConfirmation,
  type GuardLine,
  type OrderGuardVerdict,
  type PriceGuardConfirmation,
} from "@shared/pricing/priceGuard";
import type { OrderDiscounts } from "@shared/pricing/lineSnapshot";
import { isAtLeast } from "@shared/accessPolicy";
import { notify } from "./signals";
import { raiseExceptionReview, staffRoleOf } from "./exceptionReviews";
import { resolveUserNames } from "./userDisplayName";

type Executor = typeof db | any;

export async function priceGuardEnabled(orgId: string, client: Executor = db): Promise<boolean> {
  return (await priceGuardSettings(orgId, client)).enabled;
}

/** The switch and when below-minimum Signals go out (admin settings). */
export async function priceGuardSettings(
  orgId: string,
  client: Executor = db,
): Promise<{ enabled: boolean; minSignal: "immediate" | "twice_daily" }> {
  const [row] = await client
    .select({ enabled: organizations.priceGuardEnabled, minSignal: organizations.priceGuardMinSignal })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return { enabled: row?.enabled === true, minSignal: row?.minSignal === "twice_daily" ? "twice_daily" : "immediate" };
}

export type GuardManager = { id: string; name: string; role: string };

/**
 * The people a cashier can name under "Manager agreed": managers and admins
 * of this org. Names and ids only. The owner's platform-wide login is left
 * out: it has no org, so listing it would show one shop's till the owner
 * accounts of every other shop.
 */
export async function listGuardManagers(orgId: string, client: Executor = db): Promise<GuardManager[]> {
  const rows: Array<{ authUserId: string | null; replitUserId: string; role: string | null; name: string | null; email: string | null; isOwner: number }> =
    await client
      .select({
        authUserId: allowedUsers.authUserId,
        replitUserId: allowedUsers.replitUserId,
        role: allowedUsers.role,
        name: allowedUsers.name,
        email: allowedUsers.email,
        isOwner: allowedUsers.isOwner,
      })
      .from(allowedUsers)
      .where(eq(allowedUsers.orgId, orgId));
  const people = rows
    .map((r) => ({ id: r.authUserId ?? r.replitUserId, role: r.isOwner ? "SUPER_ADMIN" : (r.role ?? ""), name: r.name, email: r.email }))
    .filter((r) => !!r.id && isAtLeast(r.role, "MANAGER"));
  const names = await resolveUserNames(people.filter((p) => !p.name).map((p) => p.id));
  return people
    .map((p) => ({ id: p.id, role: p.role, name: p.name || names.get(p.id) || p.email || p.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type OrderItemRow = {
  product_id: string | null;
  quantity: unknown;
  unit_price: unknown;
  list_price?: unknown;
  floor_price?: unknown;
  unit_cost?: unknown;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function guardLinesFromItems(items: OrderItemRow[]): GuardLine[] {
  return items
    .filter((i) => !!i.product_id)
    .map((i) => ({
      productId: i.product_id as string,
      quantity: num(i.quantity) ?? 0,
      unitPrice: num(i.unit_price) ?? 0,
      listPrice: num(i.list_price),
      floorPrice: num(i.floor_price),
      unitCost: num(i.unit_cost),
    }));
}

export type RecordGuardArgs = {
  orgId: string;
  orderId: string;
  /** Who rang the sale. */
  actorUserId: string | null;
  items: OrderItemRow[];
  pricing: OrderDiscounts | null;
  /** `body.priceGuard` as sent by the till, unparsed. */
  rawConfirmation: unknown;
  isPersonalUse: boolean;
  /** Arrived as an offline replay. */
  offline: boolean;
};

export type RecordGuardResult = {
  verdict: OrderGuardVerdict;
  guardId: string;
  signalled: boolean;
} | null;

/**
 * Checks one placed sale and records what the guard found, inside the sale's
 * transaction and under a savepoint: a problem here is logged and the sale
 * goes through, exactly as silent recording does.
 *
 * With the switch OFF only a confirmation the till did send is kept (a sale
 * rung while it was on and replayed after it was turned off); nothing is
 * signalled and a sale with no confirmation is left to silent recording.
 */
export async function recordPriceGuardInTx(tx: Executor, args: RecordGuardArgs): Promise<RecordGuardResult> {
  // Personal use keeps its own Signal; it is not a sale.
  if (args.isPersonalUse) return null;
  try {
    await tx.execute(sql`SAVEPOINT price_guard_record`);
  } catch (error) {
    console.warn("[PriceGuard] could not start recording (sale unaffected):", error);
    return null;
  }
  try {
    const result = await recordInner(tx, args);
    await tx.execute(sql`RELEASE SAVEPOINT price_guard_record`);
    return result;
  } catch (error) {
    await tx.execute(sql`ROLLBACK TO SAVEPOINT price_guard_record`);
    console.warn("[PriceGuard] recording failed (sale unaffected):", error);
    return null;
  }
}

async function recordInner(tx: Executor, args: RecordGuardArgs): Promise<RecordGuardResult> {
  const settings = await priceGuardSettings(args.orgId, tx);
  let confirmation: PriceGuardConfirmation | null = readConfirmation(args.rawConfirmation);
  if (!settings.enabled && !confirmation) return null;

  // "Manager agreed" must name a manager or admin of this shop who is not the
  // cashier. Anyone else leaves the reason incomplete, so the lines count as
  // unconfirmed rather than the sale being refused.
  let managerName: string | null = null;
  if (confirmation?.reason === "manager_agreed" && confirmation.managerUserId) {
    const managers = await listGuardManagers(args.orgId, tx);
    const named = managers.find((m) => m.id === confirmation!.managerUserId);
    if (!named || named.id === args.actorUserId) {
      confirmation = { ...confirmation, managerUserId: undefined };
    } else {
      managerName = named.name;
    }
  }

  const verdict = evaluateOrderGuard(guardLinesFromItems(args.items), args.pricing, confirmation);
  if (!verdict.any) return null;
  const complete = !!confirmation && confirmationProblem(confirmation) == null;
  return persistGuard(tx, {
    orgId: args.orgId,
    orderId: args.orderId,
    actorUserId: args.actorUserId,
    source: "sale",
    verdict,
    confirmation,
    managerName,
    managerUserId: complete && confirmation?.reason === "manager_agreed" ? confirmation.managerUserId ?? null : null,
    offline: args.offline,
    settings,
  });
}

/**
 * Stores one guard row with its Needs a look row and, with the switch on, its
 * Signals. Shared by the sale and a manager's edit so both are told the same
 * way: the Signal names the person, so notify() sends it only to people who
 * outrank them.
 */
async function persistGuard(
  tx: Executor,
  args: {
    orgId: string;
    orderId: string;
    actorUserId: string | null;
    source: "sale" | "edit";
    verdict: OrderGuardVerdict;
    confirmation: PriceGuardConfirmation | null;
    managerName: string | null;
    managerUserId: string | null;
    offline: boolean;
    settings: { enabled: boolean; minSignal: "immediate" | "twice_daily" };
  },
): Promise<RecordGuardResult> {
  const { verdict, confirmation, managerUserId } = args;
  const { enabled, minSignal } = args.settings;
  const belowCost = verdict.linesBelowCost > 0 || verdict.orderBelowCost;
  const severity: "warning" | "error" = verdict.confirmed === false || belowCost ? "error" : "warning";
  const unconfirmedLines = verdict.flagged.filter((f) => f.needsConfirmation && !f.confirmed).length;

  const insert = tx
    .insert(priceGuardOrders)
    .values({
      orgId: args.orgId,
      orderId: args.orderId,
      userId: args.actorUserId,
      source: args.source,
      reason: confirmation?.reason ?? null,
      reasonNote: confirmation?.note?.trim() ? confirmation.note.trim() : null,
      confirmed: verdict.confirmed,
      offline: args.offline,
      confirmedAt: confirmation?.confirmedAt ?? null,
      severity,
      flaggedLines: verdict.flagged.length,
      unconfirmedLines,
      underMinimum: verdict.underMinimum.toFixed(2),
      linesBelowCost: verdict.linesBelowCost,
      orderBelowCost: verdict.orderBelowCost,
      underCost: verdict.underCost.toFixed(2),
      managerUserId,
    });
  // A replayed sale is recorded once; each edit is its own row.
  const [row] = await (args.source === "sale"
    ? insert.onConflictDoNothing({ target: priceGuardOrders.orderId, where: sql`${priceGuardOrders.source} = 'sale'` })
    : insert
  ).returning({ id: priceGuardOrders.id });
  if (!row) return null;

  const who = args.actorUserId ? (await resolveUserNames([args.actorUserId])).get(args.actorUserId) ?? "Unknown" : "Unknown";
  const orderRef = orderRefOf(args.orderId);
  const message = priceGuardSignalLine({
    verdict,
    orderRef,
    who,
    reason: confirmation?.reason ?? null,
    note: confirmation?.note ?? null,
    managerName: args.managerName,
    edited: args.source === "edit",
  });
  // Needs a look (CMP-02) works whatever the switch: every guard row is an
  // exception to review, queued by the role of the person who rang it.
  await raiseExceptionReview(tx, {
    orgId: args.orgId,
    kind: "price",
    sourceId: row.id,
    orderId: args.orderId,
    subjectUserId: args.actorUserId,
    subjectRole: await staffRoleOf(args.orgId, args.actorUserId, tx),
    severity,
    summary: message,
    amount: verdict.underMinimum > 0 ? verdict.underMinimum : verdict.underCost,
  });
  if (!enabled) return { verdict, guardId: row.id, signalled: false };

  // "Manager agreed" names someone: ask them (CMP-05). Addressed to that one
  // person, straight away whatever the round-up setting. The sale stands
  // whatever they answer.
  if (managerUserId) {
    await notify(
      {
        orgId: args.orgId,
        title: `Did you agree this price? — ${who}`,
        message: `${who} says you agreed £${verdict.underMinimum.toFixed(2)} under minimum on order ${orderRef}. Answer Yes, I agreed or No.`,
        severity: "warning",
        source: "price_guard_manager_check",
        audience: { userIds: [managerUserId] },
        metadata: { orderId: args.orderId, entityId: row.id },
      },
      tx,
    );
  }

  // Below cost always goes now. Below minimum goes now or waits for the next
  // twice-daily round-up, as an admin set it (PRC-04).
  if (!belowCost && minSignal === "twice_daily") {
    await tx.update(priceGuardOrders).set({ signalPending: true }).where(eq(priceGuardOrders.id, row.id));
    await raiseRepeatPatternSignal(tx, args.orgId, args.actorUserId, who);
    return { verdict, guardId: row.id, signalled: false };
  }

  // One Signal per order (PRC-04). It names the person who rang it, so
  // notify() sends it only to people who outrank them: a cashier's to managers
  // and above, a manager's to admins and the owner only.
  const kindTitle = belowCost ? "Below cost" : verdict.confirmed === false ? "Unconfirmed price" : "Below minimum";
  const signal = await notify(
    {
      orgId: args.orgId,
      title: args.source === "edit" ? `${kindTitle} after an edit — ${who}` : `${kindTitle} — ${who}`,
      message,
      severity,
      source: "price_guard",
      subjectUserId: args.actorUserId,
      metadata: { orderId: args.orderId, entityId: row.id },
    },
    tx,
  );
  await tx.update(priceGuardOrders).set({ signalId: signal.id }).where(eq(priceGuardOrders.id, row.id));
  await raiseRepeatPatternSignal(tx, args.orgId, args.actorUserId, who);
  return { verdict, guardId: row.id, signalled: true };
}

export type RecordGuardEditArgs = {
  orgId: string;
  orderId: string;
  /** The manager or admin who made the edit. */
  actorUserId: string | null;
  beforeItems: OrderItemRow[];
  afterItems: OrderItemRow[];
  /** The order's discounts before the edit and after it. */
  beforePricing: OrderDiscounts | null;
  pricing: OrderDiscounts | null;
};

/** An order row's discounts, as the guard shares them over its lines. */
export function orderDiscountsOf(row: {
  subtotal?: unknown;
  tier_discount?: unknown;
  promo_discount?: unknown;
  points_discount?: unknown;
  vat_rate?: unknown;
}): OrderDiscounts | null {
  const subtotal = num(row.subtotal);
  if (subtotal == null) return null;
  return {
    subtotal,
    netAfterDiscounts: subtotal - (num(row.tier_discount) ?? 0) - (num(row.promo_discount) ?? 0),
    pointsDiscount: num(row.points_discount),
    vatRate: num(row.vat_rate),
  };
}

const lineKey = (i: OrderItemRow) => `${num(i.unit_price) ?? 0}|${num(i.quantity) ?? 0}`;

/**
 * A manager's edit after the sale (PUT /api/orders/:id). Only what the edit
 * changed is theirs: a line whose price or quantity is new, and the order
 * going below cost when it was not before. A breach the sale already had
 * stays the cashier's and is not counted again. With the switch OFF this
 * does nothing: silent recording (price_exceptions, source 'edit') has it.
 * Never blocks the edit: own savepoint, a problem only logs.
 */
export async function recordPriceGuardEditInTx(tx: Executor, args: RecordGuardEditArgs): Promise<RecordGuardResult> {
  try {
    await tx.execute(sql`SAVEPOINT price_guard_edit`);
  } catch (error) {
    console.warn("[PriceGuard] could not start recording an edit (edit unaffected):", error);
    return null;
  }
  try {
    const result = await recordEditInner(tx, args);
    await tx.execute(sql`RELEASE SAVEPOINT price_guard_edit`);
    return result;
  } catch (error) {
    await tx.execute(sql`ROLLBACK TO SAVEPOINT price_guard_edit`);
    console.warn("[PriceGuard] recording an edit failed (edit unaffected):", error);
    return null;
  }
}

async function recordEditInner(tx: Executor, args: RecordGuardEditArgs): Promise<RecordGuardResult> {
  const settings = await priceGuardSettings(args.orgId, tx);
  if (!settings.enabled) return null;
  const before = new Map<string, string>();
  for (const i of args.beforeItems) if (i.product_id) before.set(i.product_id, lineKey(i));
  const changed = new Set(
    args.afterItems.filter((i) => !!i.product_id && before.get(i.product_id) !== lineKey(i)).map((i) => i.product_id as string),
  );
  const now = evaluateOrderGuard(guardLinesFromItems(args.afterItems), args.pricing, null);
  const was = evaluateOrderGuard(guardLinesFromItems(args.beforeItems), args.beforePricing, null);
  const flagged = now.flagged.filter((f) => changed.has(f.productId)).map((f) => ({ ...f, needsConfirmation: false, confirmed: false }));
  const belowCostProductIds = now.belowCostProductIds.filter((p) => changed.has(p));
  const orderBelowCost = now.orderBelowCost && !was.orderBelowCost;
  if (flagged.length === 0 && belowCostProductIds.length === 0 && !orderBelowCost) return null;
  const underMinimum = Math.round(flagged.reduce((s, f) => s + f.underMinimum * 100, 0)) / 100;
  const verdict: OrderGuardVerdict = {
    flagged,
    underMinimum,
    // Nobody at a till was asked: a manager's edit carries no reason.
    needsConfirmation: 0,
    confirmed: null,
    linesBelowCost: belowCostProductIds.length,
    belowCostProductIds,
    orderBelowCost,
    underCost: belowCostProductIds.length > 0 || orderBelowCost ? now.underCost : 0,
    any: true,
  };
  return persistGuard(tx, {
    orgId: args.orgId,
    orderId: args.orderId,
    actorUserId: args.actorUserId,
    source: "edit",
    verdict,
    confirmation: null,
    managerName: null,
    managerUserId: null,
    offline: false,
    settings,
  });
}

/**
 * Repeat patterns (PRC-09): REPEAT_THRESHOLD flagged sales by one person in
 * REPEAT_WINDOW_DAYS raise ONE Signal to admins (and the owner), and no other
 * until a window has passed since it. It names the person, so an admin's own
 * pattern reaches the owner only.
 */
export async function raiseRepeatPatternSignal(tx: Executor, orgId: string, userId: string | null, who: string): Promise<boolean> {
  if (!userId) return false;
  const since = new Date(Date.now() - REPEAT_WINDOW_DAYS * 86_400_000);
  const [count] = await tx
    .select({ n: sql<number>`COUNT(*)::int`, under: sql<string>`COALESCE(SUM(${priceGuardOrders.underMinimum}), 0)` })
    .from(priceGuardOrders)
    .where(and(eq(priceGuardOrders.orgId, orgId), eq(priceGuardOrders.userId, userId), gte(priceGuardOrders.createdAt, since)));
  const n = Number(count?.n) || 0;
  if (n < REPEAT_THRESHOLD) return false;
  const [already] = await tx
    .select({ id: orgNotifications.id })
    .from(orgNotifications)
    .where(
      and(
        eq(orgNotifications.orgId, orgId),
        eq(orgNotifications.source, "price_guard_repeat"),
        eq(orgNotifications.subjectUserId, userId),
        gte(orgNotifications.createdAt, since),
      ),
    )
    .limit(1);
  if (already) return false;
  await notify(
    {
      orgId,
      title: `Repeat price overrides — ${who}`,
      message: `${who} has ${n} sales flagged in the last ${REPEAT_WINDOW_DAYS} days, £${Number(count?.under ?? 0).toFixed(2)} under minimum. See Price overrides in Evidence.`,
      severity: "warning",
      source: "price_guard_repeat",
      subjectUserId: userId,
      metadata: { userId },
    },
    tx,
  );
  return true;
}

export class ManagerAnswerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/**
 * The named manager's answer to "Manager agreed" (CMP-05). Only that manager
 * may answer, and only once. A "No" goes to the owner; the sale stands either
 * way — the money has been taken, and undoing it is a refund's job.
 */
export async function answerManagerCheck(args: {
  orgId: string;
  guardId: string;
  userId: string;
  answer: "yes" | "no";
}): Promise<{ answer: "yes" | "no" }> {
  return db.transaction(async (tx: Executor) => {
    const [row] = await tx
      .select()
      .from(priceGuardOrders)
      .where(and(eq(priceGuardOrders.id, args.guardId), eq(priceGuardOrders.orgId, args.orgId)))
      .for("update");
    // Someone other than the named manager gets the same answer as a missing
    // row, so the route cannot be used to find out who agreed to what.
    if (!row || row.managerUserId !== args.userId) {
      throw new ManagerAnswerError("There is nothing here for you to answer.", 404, "PRICE_GUARD_CHECK_NOT_FOUND");
    }
    if (row.managerAnswer) {
      throw new ManagerAnswerError("You have already answered this one.", 409, "PRICE_GUARD_CHECK_ANSWERED");
    }
    await tx
      .update(priceGuardOrders)
      .set({ managerAnswer: args.answer, managerAnsweredAt: new Date() })
      .where(eq(priceGuardOrders.id, row.id));
    if (args.answer === "no") {
      const names = await resolveUserNames([args.userId, row.userId].filter(Boolean) as string[]);
      const manager = names.get(args.userId) ?? "The manager";
      const cashier = row.userId ? names.get(row.userId) ?? "a cashier" : "a cashier";
      await notify(
        {
          orgId: args.orgId,
          title: `Manager did not agree — ${cashier}`,
          message: `${manager} says they did not agree £${Number(row.underMinimum).toFixed(2)} under minimum on order ${orderRefOf(row.orderId)} by ${cashier}. The sale stands.`,
          severity: "error",
          source: "price_guard_manager_no",
          metadata: { orderId: row.orderId, entityId: row.id },
        },
        tx,
      );
    }
    return { answer: args.answer };
  });
}
