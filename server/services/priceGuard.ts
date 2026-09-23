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
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { allowedUsers, organizations, priceGuardOrders } from "@shared/schema";
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
import { resolveUserNames } from "./userDisplayName";

type Executor = typeof db | any;

export async function priceGuardEnabled(orgId: string, client: Executor = db): Promise<boolean> {
  const [row] = await client
    .select({ enabled: organizations.priceGuardEnabled })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return row?.enabled === true;
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
  const enabled = await priceGuardEnabled(args.orgId, tx);
  let confirmation: PriceGuardConfirmation | null = readConfirmation(args.rawConfirmation);
  if (!enabled && !confirmation) return null;

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
  const belowCost = verdict.linesBelowCost > 0 || verdict.orderBelowCost;
  const severity: "warning" | "error" = verdict.confirmed === false || belowCost ? "error" : "warning";
  const unconfirmedLines = verdict.flagged.filter((f) => f.needsConfirmation && !f.confirmed).length;
  const managerUserId = complete && confirmation?.reason === "manager_agreed" ? confirmation.managerUserId ?? null : null;

  const [row] = await tx
    .insert(priceGuardOrders)
    .values({
      orgId: args.orgId,
      orderId: args.orderId,
      userId: args.actorUserId,
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
    })
    .onConflictDoNothing({ target: priceGuardOrders.orderId })
    .returning({ id: priceGuardOrders.id });
  if (!row) return null;
  if (!enabled) return { verdict, guardId: row.id, signalled: false };

  const who = args.actorUserId ? (await resolveUserNames([args.actorUserId])).get(args.actorUserId) ?? "Unknown" : "Unknown";
  const orderRef = orderRefOf(args.orderId);
  const message = priceGuardSignalLine({
    verdict,
    orderRef,
    who,
    reason: confirmation?.reason ?? null,
    note: confirmation?.note ?? null,
    managerName,
  });
  // One Signal per order (PRC-04). It names the person who rang it, so
  // notify() sends it only to people who outrank them: a cashier's to managers
  // and above, a manager's to admins and the owner only.
  const signal = await notify(
    {
      orgId: args.orgId,
      title: belowCost ? `Below cost — ${who}` : verdict.confirmed === false ? `Unconfirmed price — ${who}` : `Below minimum — ${who}`,
      message,
      severity,
      source: "price_guard",
      subjectUserId: args.actorUserId,
      metadata: { orderId: args.orderId, entityId: row.id },
    },
    tx,
  );
  // "Manager agreed" names someone: ask them (CMP-05). Addressed to that one
  // person. The sale stands whatever they answer.
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
  await tx.update(priceGuardOrders).set({ signalId: signal.id }).where(eq(priceGuardOrders.id, row.id));
  return { verdict, guardId: row.id, signalled: true };
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
