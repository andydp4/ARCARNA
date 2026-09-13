import type { Express, RequestHandler } from "express";
import { requireRole } from "../auth";
import { requireOpenShift } from "../middleware/requireOpenShift";
import { requireActiveCashierShift, attachActiveCashierShift } from "../middleware/requireActiveCashierShift";
import { refreshClosedCashierShiftSummary } from "../services/cashierShiftEngine";
import {
  cashierShiftForBackdatedOrder,
  resolveOrderDating,
  settleBackdatedShift,
} from "../services/orderDating";
import { z } from "zod";
import { orderTenderLegSchema, sumTenderLegs } from "@shared/schema";
import { validateGiftCardCode } from "@shared/giftCards/code";
import { roundMoney } from "@shared/giftCards/balance";
import { redeemGiftCardInTx } from "../lib/giftCardService";
import { redeemPointsInTx } from "../lib/loyaltyRedemptionService";
import { resolveUserNames } from "../services/userDisplayName";
import { currentTradingDay, localInstantAt } from "@shared/time/tradingDay";
import { orgTimeZone } from "../services/tradingDayShift";
import { publishOpsEvent } from "../services/opsBus";
import { completeOrderTx, reopenOrderTx, OrderReopenRefusedError } from "../services/orderCompletion";
import { CreditError } from "../services/creditLedger";

/**
 * What the goods on a personal-use order cost the business.
 *
 * Taken from the products' recorded cost price, because that is what actually
 * left the shelf. Items with no recorded cost contribute nothing rather than
 * guessing — an invented figure here would land in the expenses and in the
 * Signal a manager reads.
 */
async function personalUseStockCost(tx: any, orderId: string): Promise<number> {
  const { orderItems, products } = await import('@shared/schema');
  const { eq } = await import('drizzle-orm');
  const rows = await tx
    .select({ quantity: orderItems.quantity, costPrice: products.costPrice })
    .from(orderItems)
    .leftJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, orderId));
  const total = rows.reduce(
    (sum: number, r: { quantity: unknown; costPrice: unknown }) =>
      sum + (r.costPrice == null ? 0 : Number(r.quantity) * parseFloat(String(r.costPrice))),
    0,
  );
  return Math.round(total * 100) / 100;
}

/**
 * The promise made at the till, resolved to an absolute instant server-side
 * (brief, "Due time"): a wall-clock `dueTime` ("HH:MM") is read against the
 * order's own trading day in the org's timezone; `dueInMinutes` is read
 * against when the order was actually received — the offline-replay instant
 * when there is one, otherwise now — never against the tablet's clock or an
 * absolute instant it sent. `dueTime` wins when both are sent: it is the more
 * precise of the two, not a preference either way is likely to hit in
 * practice since the till only ever sends one.
 */
export function resolveDuePromise(
  body: { dueInMinutes?: unknown; dueTime?: unknown },
  receivedAt: Date,
  tradingDate: string,
  timeZone: string,
): { ok: true; etaGiven: Date | null } | { ok: false; message: string; code: string } {
  const dueTime = typeof body.dueTime === "string" ? body.dueTime : undefined;
  if (dueTime) {
    try {
      return { ok: true, etaGiven: localInstantAt(tradingDate, dueTime, timeZone) };
    } catch {
      return {
        ok: false,
        message: "Due time must be a 24-hour HH:MM time.",
        code: "ORDER_DUE_TIME_INVALID",
      };
    }
  }
  const dueInMinutes = typeof body.dueInMinutes === "number" ? body.dueInMinutes : undefined;
  if (dueInMinutes !== undefined) {
    return { ok: true, etaGiven: new Date(receivedAt.getTime() + dueInMinutes * 60_000) };
  }
  return { ok: true, etaGiven: null };
}

/** A checkout expense line — `POST /api/orders` `expenses[]` (owner, Q12). */
export const orderExpenseInputSchema = z.object({
  category: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  amount: z.coerce.number().positive(),
});
export type OrderExpenseInput = z.infer<typeof orderExpenseInputSchema>;

/**
 * Checkout expense lines → insertable `order_expenses` rows (brief, owner
 * Q12: "costs, never part of the order total"). Pure and deliberately blind
 * to the order's `total` — it has no parameter for it and cannot reach it —
 * so an expense line can never, even by a future edit's accident, change
 * what the order is charged.
 */
export function buildOrderExpenseRows(
  orgId: string,
  orderId: string,
  lines: OrderExpenseInput[],
): Array<{ orgId: string; orderId: string; category: string; description: string | null; amount: string }> {
  return lines.map((line) => ({
    orgId,
    orderId,
    category: line.category,
    description: line.description ?? null,
    amount: String(roundMoney(line.amount)),
  }));
}

/** One candidate for the default-owner rule — the shape `resolveDefaultOwner` decides over. */
export interface DefaultOwnerCandidate {
  userId: string;
  station: "collection" | "delivery" | "both" | null;
  onBreak: boolean;
  /** Seen within the presence window (15 min) — see `server/services/opsBoard.ts`. */
  present: boolean;
  /** Currently-open orders assigned to them. */
  openCount: number;
}

/**
 * The default-owner rule (brief, "Decisions locked" → Assignment; owner's
 * answer Q4/Q16): the inputter, if they are on the order's station (or
 * Both) — regardless of the presence window, since keying the order in IS
 * being present; otherwise the PRESENT, not-on-break station member (or
 * Both) with the fewest open orders; otherwise nobody (Unassigned — a station
 * alert is N5a's, not built here).
 *
 * Pure and synchronous so `defaultOwner.test.ts` can assert the three cases
 * (inputter wins, least-loaded wins, nobody eligible) without a database.
 */
export function resolveDefaultOwner(
  fulfilmentMethod: "collection" | "delivery",
  inputUserId: string | null,
  candidates: DefaultOwnerCandidate[],
): string | null {
  const onStation = (c: DefaultOwnerCandidate) => c.station === fulfilmentMethod || c.station === "both";

  if (inputUserId) {
    const inputter = candidates.find((c) => c.userId === inputUserId);
    if (inputter && onStation(inputter)) return inputUserId;
  }

  const eligible = candidates.filter((c) => onStation(c) && c.present && !c.onBreak);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => a.openCount - b.openCount);
  return eligible[0].userId;
}

/** `ops_staff` for the org, as `resolveDefaultOwner` needs them — read inside the creation transaction. */
async function loadDefaultOwnerCandidates(
  tx: any,
  orgId: string,
  now: Date,
): Promise<DefaultOwnerCandidate[]> {
  const { opsStaff } = await import("@shared/schema");
  const { orders: opsOrdersTable } = await import("../../apps/server/src/db/schema");
  const { eq, and, ne, inArray } = await import("drizzle-orm");

  const staffRows = await tx.select().from(opsStaff).where(eq(opsStaff.orgId, orgId));
  if (staffRows.length === 0) return [];

  const userIds = staffRows.map((r: { userId: string }) => r.userId);
  const openRows = await tx
    .select({ assignedUserId: opsOrdersTable.assigned_user_id })
    .from(opsOrdersTable)
    .where(
      and(
        eq(opsOrdersTable.org_id, orgId),
        ne(opsOrdersTable.status, "completed"),
        inArray(opsOrdersTable.assigned_user_id, userIds),
      ),
    );
  const openCounts = new Map<string, number>();
  for (const row of openRows as Array<{ assignedUserId: string | null }>) {
    if (!row.assignedUserId) continue;
    openCounts.set(row.assignedUserId, (openCounts.get(row.assignedUserId) ?? 0) + 1);
  }

  const presentCutoff = now.getTime() - 15 * 60_000;
  return staffRows.map(
    (row: { userId: string; station: string | null; onBreak: boolean; lastSeenAt: Date | null }): DefaultOwnerCandidate => ({
      userId: row.userId,
      station: (row.station as DefaultOwnerCandidate["station"]) ?? null,
      onBreak: row.onBreak,
      present: row.lastSeenAt != null && row.lastSeenAt.getTime() >= presentCutoff,
      openCount: openCounts.get(row.userId) ?? 0,
    }),
  );
}

/** `organizations.ops_auto_claim_on_create` — default on (migration 065). */
async function opsAutoClaimEnabled(orgId: string): Promise<boolean> {
  try {
    const { db: mainDb } = await import("../db");
    const { organizations } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const [org] = await mainDb
      .select({ autoClaim: organizations.opsAutoClaimOnCreate })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return org?.autoClaim ?? true;
  } catch (error) {
    // The default-owner rule is a nicety, not the sale — a settings-read
    // hiccup must leave the order Unassigned, never fail the sale itself.
    console.error("[Orders] Could not read ops_auto_claim_on_create; leaving the order unassigned:", error);
    return false;
  }
}

export function registerOrderRoutes(app: Express, scoped: RequestHandler[]): void {
  /**
   * The Operations Centre board. Registered before `GET /api/orders/:id` —
   * otherwise Express would match "board" as that route's `:id` param and
   * this handler would never run. On the shared-IP rate limiter's skip list
   * (server/security.ts) and never cached by the service worker
   * (client/public/sw.js): every tablet on the counter shares one IP, and a
   * stale cached board is worse than a slow one (brief finding G11).
   */
  app.get("/api/orders/board", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null } | undefined;
      if (!ctx?.orgId) {
        return res.status(400).json({ message: "The board requires org context." });
      }
      const { getOpsBoard } = await import("../services/opsBoard");
      const payload = await getOpsBoard(ctx.orgId, req.user?.id ?? null);
      res.json(payload);
    } catch (error) {
      console.error("Error building the operations board:", error);
      res.status(500).json({ message: "Failed to load the operations board" });
    }
  });

  app.post("/api/orders", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'), requireOpenShift, requireActiveCashierShift, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null; locationId: string | null; role: string };
      if (!ctx?.orgId) {
        return res.status(400).json({ message: 'Order creation requires org context. Pass X-Org-Id or ?orgId= for SUPER_ADMIN.' });
      }
      const { withTransaction } = await import('../../apps/server/src/db');
      const { orders, order_items } = await import('../../apps/server/src/db/schema');
      const { eq } = await import('drizzle-orm');
      const { publishEventTx } = await import('../eventBus');
      const { engine } = await import('../../apps/server/src/engine.wiring');
      // The engine used to hardcode 20% while the POS displayed 10%, so the
      // customer was quoted one total and charged another. Both now derive
      // from the org's configured rate — shared with the website order path so
      // the two cannot drift apart again.
      const { getOrgTaxRatePercent } = await import("../services/orgTaxRate");
      const orgTaxRate = await getOrgTaxRatePercent(ctx.orgId);

      const body = {
        ...req.body,
        orgId: ctx.orgId ?? undefined,
        locationId: ctx.locationId ?? undefined,
        ...(Number.isFinite(orgTaxRate) ? { taxRatePercent: orgTaxRate } : {}),
      };
      const userId = req.user?.id ?? "unknown";

      // Personal use: staff taking stock for themselves. Not a sale, so it must
      // never reach the sales figures — the total is forced to zero here rather
      // than trusted from the client, and the cost is booked as an expense
      // below. The reason is mandatory: a Signal that says only "personal use,
      // £14.20" gets ignored, and being read is the entire control.
      const isPersonalUse = String(body.paymentMethod ?? "").toLowerCase() === "personal_use";
      if (isPersonalUse) {
        const reason = String(body.personalUseReason ?? "").trim();
        if (reason.length < 3) {
          return res.status(400).json({
            message: "Say what this is for before recording personal use.",
            code: "PERSONAL_USE_REASON_REQUIRED",
          });
        }
        body.personalUseReason = reason;
      }

      // An order may never total less than zero. Giving money back is a refund,
      // which has its own path and its own controls; a negative order would be
      // the same payout with none of them. The message says what to do instead,
      // because a cashier who hits this is trying to give money back.
      const requestedTotal = Number(body.total);
      if (Number.isFinite(requestedTotal) && requestedTotal < 0) {
        return res.status(400).json({
          message: "An order cannot total less than zero. Use a refund to give money back.",
          code: "ORDER_TOTAL_NEGATIVE",
        });
      }

      // Split tender: a £100 sale can be £50 cash and £50 on tick. The legs are
      // the truth; `paymentMethod` becomes a label. They must add up — a split
      // that does not is a sale with money unaccounted for.
      const tenderLegs = Array.isArray(body.payments) ? body.payments : null;
      if (tenderLegs) {
        const parsed = z.array(orderTenderLegSchema).min(1).safeParse(tenderLegs);
        if (!parsed.success) {
          return res.status(400).json({
            message: parsed.error.errors[0]?.message ?? "Invalid payment split",
            code: "ORDER_PAYMENTS_INVALID",
          });
        }
        body.payments = parsed.data;
        body.paymentMethod =
          parsed.data.length === 1 ? parsed.data[0].method : "split";
      }

      // Credit needs someone to collect it from. A tick sale with no customer
      // opens a debt nobody can be chased for and — because the credit list
      // only ever shows customers, see tickCustomers.ts — nobody can even see:
      // it silently drops off `/api/tick-customers` and the balance is real
      // money the business will never recover. Checked here, before the order
      // is created, rather than left to surface once the till has already told
      // the cashier the sale went through.
      const legsForCheck: Array<{ method: string }> = Array.isArray(body.payments)
        ? body.payments
        : [];
      const usesCredit =
        String(body.paymentMethod ?? "").toLowerCase() === "tick" ||
        legsForCheck.some((leg) => String(leg.method ?? "").toLowerCase() === "tick");
      if (usesCredit && !body.customerId) {
        return res.status(400).json({
          message: "Select a customer before putting a sale on credit.",
          code: "CREDIT_CUSTOMER_REQUIRED",
        });
      }

      const usesGiftCard = body.paymentMethod === "gift_card" || !!body.giftCardCode;
      if (usesGiftCard) {
        if (!body.giftCardCode || !validateGiftCardCode(body.giftCardCode)) {
          return res.status(400).json({ message: "Valid giftCardCode is required" });
        }
        const giftCardAmount = roundMoney(Number(body.giftCardAmount ?? 0));
        if (giftCardAmount <= 0) return res.status(400).json({ message: "giftCardAmount must be positive" });
        body.giftCardAmount = giftCardAmount;
      }

      // The day the order is FOR. Normally today, in which case nothing below
      // changes. A missed day keyed in afterwards, or a pre-order, carries its
      // own date: `created_at` is set to it so the sale lands on the right day
      // in every report, and the entry moment is kept alongside so that the
      // order still says it was keyed in late. Refused outside the window
      // rather than clamped — a date that is out of range is a mistake, and
      // silently moving it would be a worse one.
      const dating = await resolveOrderDating(ctx.orgId, body.orderDate);
      if (!dating.ok) {
        return res.status(400).json({ message: dating.message, code: dating.code });
      }
      const isBackdated = dating.dating.kind === "backdated";
      const isPreorder = dating.dating.kind === "preorder";

      // The promise made at the till (brief, "Due time"). Resolved here,
      // before the transaction, against the order's own trading day and the
      // org's real timezone. Only a wall-clock `dueTime` needs either of
      // those at all — `dueInMinutes` is read against `receivedAt` alone —
      // so the extra org lookup is skipped on every order that doesn't send
      // one, which is most of them. `resolveOrderDating`'s own `timeZone` is
      // a placeholder ("UTC") on the ordinary live-sale path, where it has
      // nothing to compute; a backdated/pre-order date already carries the
      // real one (`resolveOrderDating` fetched it to classify the date).
      const receivedAt = req.offlineQueuedAt ?? new Date();
      const needsRealTimeZone = typeof body.dueTime === "string" && !isBackdated && !isPreorder;
      const timeZone = needsRealTimeZone ? await orgTimeZone(ctx.orgId) : dating.timeZone;
      const tradingDate = isBackdated || isPreorder ? dating.dating.date : currentTradingDay(timeZone, receivedAt);
      const duePromise = resolveDuePromise(body, receivedAt, tradingDate, timeZone);
      if (!duePromise.ok) {
        return res.status(400).json({ message: duePromise.message, code: duePromise.code });
      }
      // Pre-orders exist to hold a slot for a specific time; one with no
      // promise at all would sit in the Scheduled strip with nothing to
      // become on its day (brief, "Pre-orders").
      if (isPreorder && !duePromise.etaGiven) {
        return res.status(400).json({
          message: "A pre-order needs a due time on its own day.",
          code: "ORDER_PREORDER_DUE_REQUIRED",
        });
      }

      // A backdated sale belongs to the shift of the day it was sold on, the
      // way an offline order replayed after its shift closed already does. The
      // middleware resolved today's shift, which is the wrong day for this
      // order; swap it for the sold-on day's shift, opening one if that day
      // never had a shift (a whole missed day usually didn't).
      let backdatedShift: Awaited<ReturnType<typeof cashierShiftForBackdatedOrder>> = null;
      if (isBackdated && dating.instant && req.cashierShift && req.user?.id) {
        backdatedShift = await cashierShiftForBackdatedOrder(ctx.orgId, req.user.id, dating.instant);
        if (backdatedShift) {
          req.cashierShift = {
            cashierId: backdatedShift.cashierId,
            cashierShiftId: backdatedShift.id,
          };
        }
      }

      // Checkout expenses (owner, Q12) — costs, never part of the total, and
      // never trusted from `body.total`: these become `order_expenses` rows in
      // the same transaction, the same path personal use already takes.
      const rawExpenses = Array.isArray(body.expenses) ? body.expenses : [];
      const expensesParsed = z.array(orderExpenseInputSchema).safeParse(rawExpenses);
      if (!expensesParsed.success) {
        return res.status(400).json({
          message: expensesParsed.error.errors[0]?.message ?? "Invalid expenses",
          code: "ORDER_EXPENSES_INVALID",
        });
      }
      const expenseLines = expensesParsed.data;

      // The inputter's explicit choice at the till (brief, "Assignment").
      // Validated as a plain non-empty string here; whether that id is a real
      // member of staff is not this route's job to police — the same way
      // `assigned_user_id` carries no foreign key (migration 057's rationale).
      const explicitAssigneeId =
        typeof body.assignedUserId === "string" && body.assignedUserId.trim() ? body.assignedUserId.trim() : null;
      const fulfilmentMethodForAssignment: "collection" | "delivery" =
        body.fulfilmentMethod === "delivery" ? "delivery" : "collection";
      const autoClaimEnabled = explicitAssigneeId ? false : await opsAutoClaimEnabled(ctx.orgId);

      const { result, eventId, createdOrder, items } = await withTransaction(async (tx) => {
        const result = await engine.placeOrder(body);
        // The till shift is the drawer. A backdated sale's money was in a
        // drawer that has since been counted, so it joins no drawer at all:
        // putting it in today's would make today's count come up short.
        const shiftId = isBackdated ? undefined : req.shift?.id;
        const cashierShift = req.cashierShift;
        // Whoever is logged in loaded this order. Recorded independently of any
        // cashier code: the user is always known on a till sale, whereas a code
        // is only present when one was picked (migration 057).
        const inputUserId = req.user?.id ?? null;
        if (inputUserId) {
          await tx
            .update(orders)
            .set({ input_user_id: inputUserId })
            .where(eq(orders.id, result.orderId));
        }
        if (shiftId || cashierShift) {
          await tx
            .update(orders)
            .set({
              ...(shiftId ? { shift_id: shiftId } : {}),
              ...(cashierShift
                ? {
                    cashier_shift_id: cashierShift.cashierShiftId,
                    // Whoever is on the till right now loaded this order. They
                    // take 10% of its commission pool if somebody else
                    // completes it, and the whole pool if they complete it
                    // themselves. Orders arriving without a cashier shift —
                    // web and storefront — leave this NULL on purpose.
                    //
                    // Only written when a cashier CODE was actually used. These
                    // are uuid columns pointing at cashier_profiles; a shift
                    // opened on first sale has no code, and the user who loaded
                    // the order is recorded in `input_user_id` above, which is
                    // what commission is computed from.
                    ...(cashierShift.cashierId
                      ? {
                          cashier_id: cashierShift.cashierId,
                          input_cashier_id: cashierShift.cashierId,
                        }
                      : {}),
                    ...(cashierShift.queuedAt ? { created_at: cashierShift.queuedAt } : {}),
                  }
                : {}),
            })
            .where(eq(orders.id, result.orderId));
        }
        // The order's real received time (finding G21): a lazy-shift offline
        // replay with no cashier-shift token still carries `_offlineQueuedAt`,
        // and the board's clocks read `entered_at`, not `created_at` — a
        // replayed order born "received now" would show the wrong elapsed
        // time and, worse, count as newly late the moment it lands. Skipped
        // for a backdated sale, whose own "keyed in now" stamp below is what
        // that flow means by "received".
        if (!isBackdated && req.offlineQueuedAt) {
          await tx
            .update(orders)
            .set({ entered_at: req.offlineQueuedAt })
            .where(eq(orders.id, result.orderId));
        }
        // The promise made at the till, resolved above. `original_eta` is
        // frozen alongside it on this, the only write that can ever leave
        // `eta_given` NULL-to-set (brief: "`original_eta` frozen on first
        // write"; every later change is a delay, via `PATCH …/operations` /
        // `set_due`, and never touches this column again).
        if (duePromise.etaGiven) {
          await tx
            .update(orders)
            .set({ eta_given: duePromise.etaGiven, original_eta: duePromise.etaGiven })
            .where(eq(orders.id, result.orderId));
        }
        // Written last so it wins over the offline-replay stamp above: an order
        // the till dated is dated, whatever queue it arrived through.
        if (dating.instant) {
          await tx
            .update(orders)
            .set({
              created_at: dating.instant,
              entered_at: new Date(),
              date_kind: dating.dating.kind,
            })
            .where(eq(orders.id, result.orderId));
        }
        const [createdOrder] = await tx.select().from(orders).where(eq(orders.id, result.orderId));
        const items = await tx.select().from(order_items).where(eq(order_items.order_id, result.orderId));

        // `received` — the first order_events row for this order, mirroring
        // the milestone `shared/orders/opsState.ts` calls `receivedAt`
        // (brief, "Order lifecycle & timing model" table). `userId` is NULL
        // for a channel with no cashier at all — website and API orders —
        // exactly what `order_events.userId`'s doc comment says NULL means.
        {
          const { orderEvents } = await import("@shared/schema");
          await tx.insert(orderEvents).values({
            orgId: ctx.orgId!,
            orderId: result.orderId,
            kind: "received",
            at: createdOrder?.entered_at ?? createdOrder?.created_at ?? new Date(),
            userId: inputUserId,
          });
        }

        // Who is dealing with it (brief, "Assignment"). The inputter's
        // explicit choice at the till always wins; otherwise, under
        // `ops_auto_claim_on_create`, the default-owner rule picks the
        // inputter-if-on-station, then the least-loaded present station
        // member, then nobody at all.
        {
          const pickedAssignee = explicitAssigneeId
            ? explicitAssigneeId
            : autoClaimEnabled
              ? resolveDefaultOwner(
                  fulfilmentMethodForAssignment,
                  inputUserId,
                  await loadDefaultOwnerCandidates(tx, ctx.orgId!, new Date()),
                )
              : null;
          if (pickedAssignee) {
            const assignedAt = new Date();
            await tx
              .update(orders)
              .set({ assigned_user_id: pickedAssignee, assigned_at: assignedAt, assigned_by_user_id: inputUserId })
              .where(eq(orders.id, result.orderId));
            if (createdOrder) {
              createdOrder.assigned_user_id = pickedAssignee;
              createdOrder.assigned_at = assignedAt;
            }
            const { orderEvents } = await import("@shared/schema");
            await tx.insert(orderEvents).values({
              orgId: ctx.orgId!,
              orderId: result.orderId,
              kind: "assigned",
              at: assignedAt,
              userId: inputUserId,
              meta: { from: null, to: pickedAssignee, by: inputUserId, auto: !explicitAssigneeId },
            });
            // brief, alerts table: "assigned | ... | in the assign / create
            // transaction". `shouldAlertAssigned` (inside `alertAssignedInTx`)
            // silences this on self-claim (the inputter assigned it to
            // themselves, explicitly or because the default-owner rule
            // picked them) — the two carve-outs this same row documents.
            const { alertAssignedInTx } = await import("../services/opsAlerts");
            await alertAssignedInTx(tx, {
              orgId: ctx.orgId!,
              orderId: result.orderId,
              assigneeId: pickedAssignee,
              actorId: inputUserId,
              isDefaultOwnerPick: !explicitAssigneeId,
              inputUserId,
              assignedAt,
            });
          }
        }

        // Checkout expenses (owner, Q12) — rows only, never the total.
        if (expenseLines.length > 0) {
          const { orderExpenses } = await import("@shared/schema");
          await tx.insert(orderExpenses).values(buildOrderExpenseRows(ctx.orgId!, result.orderId, expenseLines));
        }

        if (usesGiftCard && createdOrder) {
          const orderTotal = parseFloat(String(createdOrder.total));
          const giftCardAmount = roundMoney(Number(body.giftCardAmount));
          if (giftCardAmount > orderTotal + 0.01) throw new Error("Gift card amount exceeds order total");
          const remainder = roundMoney(orderTotal - giftCardAmount);
          if (remainder > 0.01 && !body.remainderPaymentMethod) {
            throw new Error("remainderPaymentMethod required when gift card does not cover the full total");
          }
          await redeemGiftCardInTx(tx, {
            orgId: ctx.orgId!, code: body.giftCardCode, amount: giftCardAmount,
            orderId: result.orderId, actorUserId: userId,
          });
          const paymentLabel = remainder > 0.01 ? `gift_card+${body.remainderPaymentMethod}` : "gift_card";
          if (paymentLabel !== createdOrder.payment_method) {
            await tx.update(orders).set({ payment_method: paymentLabel }).where(eq(orders.id, result.orderId));
            createdOrder.payment_method = paymentLabel;
          }
        }

        // Written after the order exists and after any total adjustment, so the
        // legs can be checked against the figure actually charged.
        if (tenderLegs && createdOrder) {
          const orderTotal = roundMoney(parseFloat(String(createdOrder.total)));
          const legTotal = sumTenderLegs(body.payments);
          if (Math.abs(legTotal - orderTotal) > 0.005) {
            throw new Error(
              `Payments add up to £${legTotal.toFixed(2)} but the order is £${orderTotal.toFixed(2)}`,
            );
          }
          const { orderPayments } = await import('@shared/schema');
          await tx.insert(orderPayments).values(
            body.payments.map((leg: { method: string; amount: number }) => ({
              orgId: ctx.orgId!,
              orderId: result.orderId,
              method: leg.method,
              amount: String(roundMoney(leg.amount)),
            })),
          );
        } else if (createdOrder) {
          // A single-tender sale is one leg for the whole total, so every
          // money figure can read the legs and never the label.
          const { orderPayments } = await import('@shared/schema');
          await tx.insert(orderPayments).values({
            orgId: ctx.orgId!,
            orderId: result.orderId,
            method: String(createdOrder.payment_method),
            amount: String(roundMoney(parseFloat(String(createdOrder.total)))),
          });
        }

        if (isPersonalUse && createdOrder) {
          // Zero the sale and book the goods as a cost of the day. The stock has
          // already been deducted by the ordinary order path — it left the
          // building either way — so only the money side needs correcting.
          const stockCost = await personalUseStockCost(tx, result.orderId);
          await tx
            .update(orders)
            .set({ total: "0.00", personal_use_reason: body.personalUseReason })
            .where(eq(orders.id, result.orderId));
          createdOrder.total = "0.00";
          if (stockCost > 0) {
            const { orderExpenses } = await import('@shared/schema');
            await tx.insert(orderExpenses).values({
              orgId: ctx.orgId!,
              orderId: result.orderId,
              category: 'personal_use',
              description: `Personal use — ${body.personalUseReason}`,
              amount: String(stockCost),
            });
          }
          await publishEventTx(tx, 'PersonalUseRecorded', result.orderId, {
            orgId: ctx.orgId,
            orderId: result.orderId,
            cashierName: req.user?.name ?? req.user?.email ?? null,
            reason: body.personalUseReason,
            stockCost,
            items: items.map((item: any) => ({ qty: item.quantity })),
          }, { source: 'api-orders' });
        }

        const redeemPoints = parseInt(String(body.redeemPoints || 0), 10);
        if (redeemPoints > 0) {
          if (!createdOrder?.customer_id) throw new Error("Customer required for points redemption");
          const discount = await redeemPointsInTx(tx, ctx.orgId!, createdOrder.customer_id, redeemPoints);
          const newTotal = roundMoney(Math.max(0, parseFloat(String(createdOrder.total)) - discount));
          await tx.update(orders).set({ total: String(newTotal) }).where(eq(orders.id, result.orderId));
          createdOrder.total = String(newTotal);
        }

        const sendEmailReceipt = body.sendEmailReceipt === true;
        const eventId = await publishEventTx(tx, 'OrderCreated', result.orderId, {
          order: {
            orderId: result.orderId,
            status: createdOrder?.status || 'pending',
            customerId: createdOrder?.customer_id,
            total: parseFloat(createdOrder?.total || '0'),
            paymentMethod: createdOrder?.payment_method,
            sendEmailReceipt,
            items: items.map((item: { id: string; product_id: string; quantity: number; unit_price: string | null; total_price: string | null }) => ({
              lineId: item.id,
              productId: item.product_id,
              qty: item.quantity,
              unitPrice: parseFloat(item.unit_price || '0'),
              lineTotal: parseFloat(item.total_price || '0'),
            })),
          },
          sendEmailReceipt,
        }, { source: 'api-orders' });

        return { result, eventId, createdOrder, items };
      });
      
      console.log(`[Orders] Created order ${result.orderId} with event ${eventId}`);
      if (req.cashierShift?.replayedToClosedShift && ctx.orgId) {
        await refreshClosedCashierShiftSummary(ctx.orgId, req.cashierShift.cashierShiftId);
      }
      if (backdatedShift && ctx.orgId) {
        await settleBackdatedShift(ctx.orgId, backdatedShift);
      }

      // Pushed AFTER commit, never from inside the transaction — a later
      // rollback must not have already told every open tablet about a row
      // that no longer exists. A fresh re-read (rather than reusing what the
      // transaction built in memory) is deliberate: it is the same query
      // `GET /api/orders/board` runs for one row, so a card that arrives over
      // the stream can never disagree with one a poll would have fetched.
      if (ctx.orgId && result?.orderId) {
        try {
          const { getOpsBoardOrder } = await import("../services/opsBoard");
          const boardOrder = await getOpsBoardOrder(ctx.orgId, result.orderId);
          if (boardOrder) publishOpsEvent(ctx.orgId, { type: "order", order: boardOrder });
        } catch (pushError) {
          // The sale already committed; a tablet that misses the push still
          // catches up on its next reconciliation poll (brief, "Live data").
          console.error("[Orders] Failed to push the new order to the board stream:", pushError);
        }
      }

      res.status(201).json({
        ...result, 
        eventId, // Include eventId in response for tracing
        order: createdOrder ? {
          id: createdOrder.id,
          status: createdOrder.status,
          total: createdOrder.total,
          paymentMethod: createdOrder.payment_method,
          createdAt: createdOrder.created_at,
          dateKind: createdOrder.date_kind ?? dating.dating.kind,
        } : null
      });
    } catch (error: any) {
      console.error("Error creating order:", error);
      const message = error.message || "Failed to create order";
      const status = error.name === "ZodError" || /gift card|remainderPaymentMethod|giftCard/i.test(message) ? 400 : 500;
      res.status(status).json({ message, errors: error.errors });
    }
  });

  app.get("/api/orders", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { db } = await import('../../apps/server/src/db');
      const { orders, customers } = await import('../../apps/server/src/db/schema');
      const { eq } = await import('drizzle-orm');
      // The list selected customerId but never resolved the name, so every row
      // rendered the "Walk-in" fallback while the detail view — which does join
      // customers — showed the real name.
      const baseQuery = db.select({
        id: orders.id,
        customerId: orders.customer_id,
        customerName: customers.name,
        total: orders.total,
        paymentMethod: orders.payment_method,
        channel: orders.channel,
        status: orders.status,
        fulfilmentMethod: orders.fulfilment_method,
        createdAt: orders.created_at,
        // Whether created_at is when it was keyed in or the day it is for
        // (migration 062). The counter view badges anything that is not live.
        dateKind: orders.date_kind,
        enteredAt: orders.entered_at,
        // Who loaded it. The counter view shows this because it decides where
        // the inputter's 10% of the commission goes, and because knowing who to
        // ask about an order is half of working a counter.
        inputUserId: orders.input_user_id,
        // Already on the order and never surfaced: what is holding it up.
        delayFlag: orders.delay_flag,
        delayReason: orders.delay_reason,
        revisedEta: orders.revised_eta,
        etaGiven: orders.eta_given,
      }).from(orders).leftJoin(customers, eq(orders.customer_id, customers.id));
      const allOrders = ctx?.orgId
        ? await baseQuery.where(eq(orders.org_id, ctx.orgId)).orderBy(orders.created_at)
        : await baseQuery.orderBy(orders.created_at);

      // Resolve the loader's name once for the page rather than per row.
      const names = await resolveUserNames(
        allOrders.map((o: { inputUserId: string | null }) => o.inputUserId).filter(Boolean) as string[],
      );
      res.json(
        allOrders.map((o: { inputUserId: string | null }) => ({
          ...o,
          inputUserName: o.inputUserId ? names.get(o.inputUserId) ?? null : null,
        })),
      );
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.get("/api/orders/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { db } = await import('../../apps/server/src/db');
      const { orders, order_items, products, customers } = await import('../../apps/server/src/db/schema');
      const { refunds: refundsTable, refundLines } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      const mainDb = (await import('../db')).db;
      const orderCond = ctx?.orgId ? and(eq(orders.id, req.params.id), eq(orders.org_id, ctx.orgId)) : eq(orders.id, req.params.id);
      const [order] = await db.select().from(orders).where(orderCond);
      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }
      
      const items = await db.select({
        id: order_items.id,
        productId: order_items.product_id,
        productName: products.name,
        quantity: order_items.quantity,
        unitPrice: order_items.unit_price,
        totalPrice: order_items.total_price,
      }).from(order_items)
        .leftJoin(products, eq(order_items.product_id, products.id))
        .where(eq(order_items.order_id, req.params.id));
      
      let customer = null;
      if (order.customer_id) {
        const [c] = await db.select().from(customers).where(eq(customers.id, order.customer_id));
        customer = c;
      }
      
      const refundRows = await mainDb
        .select()
        .from(refundsTable)
        .where(eq(refundsTable.orderId, req.params.id));

      // One lookup for the whole list rather than one per refund, and the same
      // definition of a person's name the shift report uses.
      const cashierNames = await resolveUserNames(refundRows.map((r) => r.cashierId));

      const refundsWithMeta = await Promise.all(
        refundRows.map(async (refund) => {
          const lines = await mainDb
            .select()
            .from(refundLines)
            .where(eq(refundLines.refundId, refund.id));
          const cashierName = cashierNames.get(refund.cashierId) ?? refund.cashierId;
          return {
            id: refund.id,
            total: refund.total,
            reason: refund.reason,
            refundMethod: refund.refundMethod,
            notes: refund.notes,
            createdAt: refund.createdAt,
            cashierName,
            lines,
          };
        }),
      );

      const refundedTotal = refundsWithMeta.reduce(
        (sum, r) => sum + parseFloat(String(r.total)),
        0,
      );

      res.json({
        id: order.id,
        customerId: order.customer_id,
        customerName: customer?.name || 'Walk-in',
        total: order.total,
        paymentMethod: order.payment_method,
        channel: order.channel,
        status: order.status,
        createdAt: order.created_at,
        refundedTotal,
        refunds: refundsWithMeta,
        items: items.map(item => ({
          id: item.id,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.totalPrice,
        }))
      });
    } catch (error) {
      console.error("Error fetching order details:", error);
      res.status(500).json({ message: "Failed to fetch order details" });
    }
  });

  /**
   * Customer receipt for an order, generated on demand.
   *
   * Complements GET /api/invoices/:id/pdf, which already accepts an order id.
   * Both are reachable from a completed order so staff never have to leave the
   * order to produce paperwork.
   */
  app.get("/api/orders/:id/receipt.pdf", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const { orders, orderItems, products, customers, organizations } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const { db } = await import("../db");

      const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, req.params.id), eq(orders.orgId, ctx.orgId)))
        .limit(1);
      // Scoped by org, so another tenant's order is indistinguishable from a
      // missing one.
      if (!order) return res.status(404).json({ message: "Order not found" });

      const itemRows = await db
        .select({
          quantity: orderItems.quantity,
          unitPrice: orderItems.unitPrice,
          totalPrice: orderItems.totalPrice,
          productName: products.name,
        })
        .from(orderItems)
        .leftJoin(products, eq(orderItems.productId, products.id))
        .where(eq(orderItems.orderId, order.id));

      const total = parseFloat(String(order.total ?? "0"));
      const items = itemRows.length
        ? itemRows.map((row) => ({
            name: row.productName || "Item",
            quantity: row.quantity,
            unitPrice: parseFloat(String(row.unitPrice ?? "0")),
            total: parseFloat(String(row.totalPrice ?? "0")),
          }))
        : [{ name: "Order total", quantity: 1, unitPrice: total, total }];

      const [customer] = order.customerId
        ? await db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1)
        : [null];

      const [org] = await db
        .select({
          defaultTaxRate: organizations.defaultTaxRate,
          receiptFooter: organizations.receiptFooter,
        })
        .from(organizations)
        .where(eq(organizations.id, ctx.orgId))
        .limit(1);

      // Order totals are gross; derive the tax component from the org's rate so
      // the receipt reconciles with the invoice for the same order.
      const taxRate = parseFloat(String(org?.defaultTaxRate ?? "0")) || 0;
      const subtotal = taxRate > 0 ? total / (1 + taxRate / 100) : total;
      const tax = Math.round((total - subtotal) * 100) / 100;

      const { loadCompanyInfo } = await import("../services/companyBranding");
      const { generateReceiptPdf } = await import("../services/pdfGenerator");

      const pdfBuffer = await generateReceiptPdf({
        receiptNumber: `R-${String(order.id).slice(0, 8).toUpperCase()}`,
        createdAt: (order.createdAt ?? new Date()).toISOString(),
        company: await loadCompanyInfo(ctx.orgId),
        items,
        subtotal: Math.round(subtotal * 100) / 100,
        tax,
        total,
        paymentMethod: order.paymentMethod ?? undefined,
        customerName: customer?.name ?? undefined,
        footerNote: org?.receiptFooter ?? undefined,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="receipt-${String(order.id).slice(0, 8)}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating receipt PDF:", error);
      res.status(500).json({ message: "Failed to generate receipt PDF" });
    }
  });

  /**
   * Kept (brief, "PATCH /api/orders/:id"). Now `FOR UPDATE` throughout: the
   * row is locked, then EVERY decision — whether this is a first completion,
   * a reopen, a hold, a resume, or an ordinary status move — is made from
   * that one locked read, closing the race the brief's finding G4 describes
   * (two "Delivered" taps outside a lock could both settle).
   *
   * `status: 'completed'` on an open row calls `completeOrderTx` — the exact
   * function `POST /api/orders/:id/transition {action:'complete'}` calls, so
   * the two produce identical rows. Anything but `reopen` is refused on an
   * already-completed row: requesting `'completed'` again is refused (only
   * `reopen` may touch a completed row), and requesting any OTHER status
   * reopens it — through `reopenOrderTx`, which decides the real destination
   * status from history rather than trusting the value this request sent.
   */
  app.patch("/api/orders/:id", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'), attachActiveCashierShift, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { withTransaction } = await import('../../apps/server/src/db');
      const { orders } = await import('../../apps/server/src/db/schema');
      const { eq, and } = await import('drizzle-orm');
      const { orderEvents, updateOrderStatusSchema } = await import('@shared/schema');
      const { publishEventTx } = await import('../eventBus');
      const { assertTransitionRoleAllowed } = await import('../services/orderTransitions');
      const orderCond = ctx?.orgId ? and(eq(orders.id, req.params.id), eq(orders.org_id, ctx.orgId)) : eq(orders.id, req.params.id);

      const validation = updateOrderStatusSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          message: 'Invalid status value',
          errors: validation.error.errors
        });
      }
      const requestedStatus = validation.data.status;
      const actorId = req.user?.id ?? null;
      const actorRole = req.user?.role ?? 'CASHIER';
      const cashierShift = (req as any).cashierShift as
        | { cashierId: string | null; cashierShiftId: string }
        | undefined;

      const outcome = await withTransaction(async (tx: any) => {
        const [row] = await tx.select().from(orders).where(orderCond).for('update').limit(1);
        if (!row) return { notFound: true as const };

        const previousStatus = String(row.status ?? 'pending');
        let backdatedShiftToSettle: Awaited<ReturnType<typeof cashierShiftForBackdatedOrder>> = null;

        if (previousStatus === 'completed') {
          if (requestedStatus === 'completed') {
            const err: any = new Error('This order is already completed — only "reopen" is allowed on it.');
            err.statusCode = 409;
            err.code = 'ORDER_TRANSITION_INVALID';
            throw err;
          }
          assertTransitionRoleAllowed({
            action: 'reopen',
            actorId: actorId ?? '',
            actorRole,
            assignedUserId: row.assigned_user_id ?? null,
            completedUserId: row.completed_user_id ?? null,
            settledAt: row.settled_at ? new Date(row.settled_at) : null,
            now: new Date(),
          });
          const result = await reopenOrderTx(tx, row, { userId: actorId });
          const eventId = await publishEventTx(tx, 'OrderStatusChanged', req.params.id, {
            orderId: req.params.id, from: previousStatus, to: result.row.status, changedAt: new Date().toISOString(),
          }, { source: 'api-orders' });
          return { notFound: false as const, updated: result.row, eventId, kind: 'reopened' as const, backdatedShiftToSettle };
        }

        if (requestedStatus === 'completed') {
          const result = await completeOrderTx(
            tx,
            row,
            { userId: actorId, cashierShift: cashierShift ?? null },
            {},
          );
          backdatedShiftToSettle = result.backdatedShiftToSettle;
          const eventId = await publishEventTx(tx, 'OrderStatusChanged', req.params.id, {
            orderId: req.params.id, from: previousStatus, to: 'completed', changedAt: new Date().toISOString(),
          }, { source: 'api-orders' });
          return { notFound: false as const, updated: result.row, eventId, kind: result.event.kind, backdatedShiftToSettle };
        }

        if (requestedStatus === previousStatus) {
          // Repeats are "no news", the same as every transition stamp.
          return { notFound: false as const, updated: row, eventId: null, kind: null, backdatedShiftToSettle };
        }

        const now = new Date();
        const patch: Record<string, unknown> = { status: requestedStatus, updated_at: now };
        let eventKind: string;
        let eventMeta: Record<string, unknown>;
        if (requestedStatus === 'on-hold') {
          patch.held_at = row.held_at ?? now;
          eventKind = 'held';
          eventMeta = { reason: null, fromStatus: previousStatus, via: 'patch' };
        } else if (previousStatus === 'on-hold') {
          patch.held_at = null;
          const heldSeconds = row.held_at
            ? Math.max(0, Math.round((now.getTime() - new Date(row.held_at).getTime()) / 1000))
            : 0;
          eventKind = 'unheld';
          eventMeta = { heldSeconds, toStatus: requestedStatus, via: 'patch' };
        } else {
          eventKind = 'status_changed';
          eventMeta = { from: previousStatus, to: requestedStatus, via: 'patch' };
        }
        // Choosing "awaiting-customer" on the board's status select runs the
        // `ready` transition in spirit (brief, "Decisions locked" → Ready):
        // PATCH writing it stamps `ready_at` too, first-write-wins.
        if (requestedStatus === 'awaiting-customer' && !row.ready_at) {
          patch.ready_at = now;
        }

        const [updated] = await tx.update(orders).set(patch).where(eq(orders.id, req.params.id)).returning();
        await tx.insert(orderEvents).values({
          orgId: ctx.orgId,
          orderId: req.params.id,
          kind: eventKind,
          userId: actorId,
          at: now,
          meta: eventMeta,
        });
        const eventId = await publishEventTx(tx, 'OrderStatusChanged', req.params.id, {
          orderId: req.params.id, from: previousStatus, to: requestedStatus, changedAt: now.toISOString(),
        }, { source: 'api-orders' });

        return { notFound: false as const, updated, eventId, kind: eventKind, backdatedShiftToSettle };
      });

      if (outcome.notFound) {
        return res.status(404).json({ message: 'Order not found' });
      }

      if (outcome.backdatedShiftToSettle && ctx.orgId) {
        await settleBackdatedShift(ctx.orgId, outcome.backdatedShiftToSettle);
      }

      console.log(`[Orders] Status changed ${req.params.id} (kind: ${outcome.kind ?? 'no-op'}, event: ${outcome.eventId})`);

      res.json({ ...outcome.updated, eventId: outcome.eventId });
    } catch (error: any) {
      console.error("Error updating order:", error);
      if (error instanceof OrderReopenRefusedError) {
        return res.status(409).json({ message: error.message, code: error.code });
      }
      if (error instanceof CreditError) {
        return res.status(error.status).json({ message: error.message, code: error.code });
      }
      if (error?.name === 'TransitionForbiddenError') {
        return res.status(403).json({ message: error.message, code: error.code ?? 'ORDER_TRANSITION_FORBIDDEN' });
      }
      const status = error?.statusCode ?? 500;
      res.status(status).json({ message: error?.message || "Failed to update order", code: error?.code });
    }
  });

  app.put("/api/orders/:id", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null; locationId?: string | null };
      const { db } = await import('../../apps/server/src/db');
      const { orders, order_items } = await import('../../apps/server/src/db/schema');
      const { eq, and } = await import('drizzle-orm');
      const orderCond = ctx?.orgId ? and(eq(orders.id, req.params.id), eq(orders.org_id, ctx.orgId)) : eq(orders.id, req.params.id);
      const [existing] = await db.select().from(orders).where(orderCond);
      if (!existing) return res.status(404).json({ message: 'Order not found' });
      
      const { engine } = await import('../../apps/server/src/engine.wiring');
      const { publishEvent } = await import('../eventBus');
      const result = await engine.updateOrder(req.params.id, {
        ...req.body,
        orgId: ctx.orgId,
        locationId: ctx?.locationId ?? req.body.locationId,
      });
      
      // Fetch updated order details
      const [updatedOrder] = await db.select().from(orders).where(eq(orders.id, req.params.id));
      const items = await db.select().from(order_items).where(eq(order_items.order_id, req.params.id));

      // The engine can move `status` itself as a side effect of a line edit
      // (packages/domain/src/engine.ts: a stock shortfall forces `on-hold`,
      // clearing it promotes back to `pending`) — a `status_changed` event and
      // `held_at` sync are owed here even though nothing ASKED for a status
      // change. This runs as its own small transaction immediately after the
      // engine's — `engine.updateOrder` owns its transaction boundary
      // internally and does not expose it to route code, so the two cannot
      // share one without touching `packages/domain/src/engine.ts`, which is
      // out of this package's scope.
      if (ctx?.orgId && updatedOrder && existing.status !== updatedOrder.status) {
        const { withTransaction } = await import('../../apps/server/src/db');
        const { orderEvents } = await import('@shared/schema');
        await withTransaction(async (tx: any) => {
          const now = new Date();
          const heldPatch: Record<string, unknown> =
            updatedOrder.status === 'on-hold'
              ? { held_at: updatedOrder.held_at ?? now }
              : existing.status === 'on-hold'
                ? { held_at: null }
                : {};
          if (Object.keys(heldPatch).length > 0) {
            await tx.update(orders).set(heldPatch).where(eq(orders.id, req.params.id));
          }
          await tx.insert(orderEvents).values({
            orgId: ctx.orgId,
            orderId: req.params.id,
            kind: 'status_changed',
            userId: req.user?.id ?? null,
            at: now,
            meta: { from: existing.status, to: updatedOrder.status, via: 'put' },
          });
        });
      }

      // Publish OrderUpdated event - critical, visible failure
      const eventId = await publishEvent('OrderUpdated', req.params.id, {
        order: {
          orderId: req.params.id,
          status: updatedOrder?.status,
          customerId: updatedOrder?.customer_id,
          total: parseFloat(updatedOrder?.total || '0'),
          items: items.map(item => ({
            lineId: item.id,
            productId: item.product_id,
            qty: item.quantity,
            unitPrice: parseFloat(item.unit_price || '0'),
            lineTotal: parseFloat(item.total_price || '0'),
          })),
        }
      }, { source: 'api-orders' });
      
      console.log(`[Orders] Updated order ${req.params.id} (event: ${eventId})`);
      
      res.json({ ...result, eventId });
    } catch (error: any) {
      console.error("Error updating order:", error);
      const message = error.message || "Failed to update order";
      // Settled-order edits are a client error (409), not a server fault.
      const status = error.name === 'ZodError' ? 400 : (error.statusCode ?? 500);
      res.status(status).json({ message, code: error.code, errors: error.errors });
    }
  });

  app.delete("/api/orders/:id", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null; locationId?: string | null };
      const orderId = req.params.id as string;
      // Single DB client + schema so the whole delete (cleanup, loyalty
      // reversal, restock, order removal) runs in ONE transaction. Mixing two
      // clients previously left orders half-deleted on a mid-way failure.
      const { db } = await import('../db');
      const {
        orders,
        orderItems,
        products,
        customers,
        refunds: refundsTable,
        refundLines,
        orderExpenses,
        loyaltyLedger,
        giftCardMovements,
        invoices,
        orderEvents,
      } = await import('@shared/schema');
      const { eq, and, inArray, sql } = await import('drizzle-orm');
      const { adjustProductLocationStock, resolveStockLocationId } = await import(
        "../services/productLocationStock",
      );
      const orderCond = ctx?.orgId
        ? and(eq(orders.id, orderId), eq(orders.orgId, ctx.orgId))
        : eq(orders.id, orderId);

      await db.transaction(async (tx) => {
        const [order] = await tx.select().from(orders).where(orderCond);
        if (!order) throw new Error('Order not found');

        // Written FIRST — an `order_events` row for a deleted order carries no
        // foreign key to `orders` on purpose (its whole point is to outlive
        // the row it describes), so its `meta` is the only place the order's
        // identity survives the delete below.
        if (order.orgId) {
          let customerName: string | null = null;
          if (order.customerId) {
            const [c] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, order.customerId));
            customerName = c?.name ?? null;
          }
          await tx.insert(orderEvents).values({
            orgId: order.orgId,
            orderId,
            kind: 'deleted',
            userId: req.user?.id ?? null,
            meta: {
              customerName,
              total: order.total,
              fulfilmentMethod: order.fulfilmentMethod,
              status: order.status,
            },
          });
        }

        const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));

        // Refunded quantity per order line (so we restock only what was NOT
        // refunded — a partial refund previously skipped ALL restock).
        const refundRows = await tx
          .select({ id: refundsTable.id })
          .from(refundsTable)
          .where(eq(refundsTable.orderId, orderId));
        const refundIds = refundRows.map((r) => r.id);
        const refundedByLine = new Map<string, number>();
        if (refundIds.length > 0) {
          const lines = await tx
            .select({ orderLineId: refundLines.orderLineId, qty: refundLines.qty })
            .from(refundLines)
            .where(inArray(refundLines.refundId, refundIds));
          for (const l of lines) {
            refundedByLine.set(l.orderLineId, (refundedByLine.get(l.orderLineId) ?? 0) + l.qty);
          }
        }

        // Reverse this order's net loyalty impact on each customer BEFORE
        // deleting the ledger rows (previously left ghost points behind).
        const ledger = await tx
          .select({ customerId: loyaltyLedger.customerId, pointsDelta: loyaltyLedger.pointsDelta })
          .from(loyaltyLedger)
          .where(eq(loyaltyLedger.orderId, orderId));
        const loyaltyByCustomer = new Map<string, number>();
        for (const row of ledger) {
          if (!row.customerId) continue;
          loyaltyByCustomer.set(row.customerId, (loyaltyByCustomer.get(row.customerId) ?? 0) + row.pointsDelta);
        }
        for (const [customerId, netDelta] of loyaltyByCustomer) {
          if (netDelta === 0) continue;
          await tx
            .update(customers)
            .set({ loyaltyPoints: sql`GREATEST(0, COALESCE(${customers.loyaltyPoints}, 0) - ${netDelta})` })
            .where(eq(customers.id, customerId));
        }

        // Remove dependent rows (all inside the transaction).
        if (refundIds.length > 0) {
          await tx.delete(giftCardMovements).where(inArray(giftCardMovements.refundId, refundIds));
          await tx.delete(refundLines).where(inArray(refundLines.refundId, refundIds));
          await tx.delete(refundsTable).where(eq(refundsTable.orderId, orderId));
        }
        await tx.delete(giftCardMovements).where(eq(giftCardMovements.orderId, orderId));
        await tx.delete(orderExpenses).where(eq(orderExpenses.orderId, orderId));
        await tx.delete(loyaltyLedger).where(eq(loyaltyLedger.orderId, orderId));
        await tx.delete(invoices).where(eq(invoices.orderId, orderId));

        // Restock only the unrefunded quantity per line, inside the transaction.
        if (order.orgId && items.length > 0) {
          const locationId = await resolveStockLocationId(
            { orgId: order.orgId, locationId: order.locationId, orderId },
            tx,
          );
          for (const item of items) {
            if (!item.productId) continue;
            const refundedQty = refundedByLine.get(item.id) ?? 0;
            const restockQty = item.quantity - refundedQty;
            if (restockQty <= 0) continue;
            const [p] = await tx
              .select({ productId: products.productId })
              .from(products)
              .where(eq(products.id, item.productId))
              .limit(1);
            await adjustProductLocationStock(
              {
                orgId: order.orgId,
                productId: item.productId,
                locationId,
                delta: restockQty,
                movement: {
                  reason: "cancellation",
                  correlationId: orderId,
                  eventId: `delete-order-${orderId}-${item.id}`,
                  sku: p?.productId || item.productId,
                },
              },
              tx,
            );
          }
        }

        await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));
        const [deleted] = await tx.delete(orders).where(orderCond).returning();
        if (!deleted) throw new Error('Order not found');
      });

      res.json({ message: "Order deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting order:", error);
      const message = error.message === 'Order not found' ? 'Order not found' : 'Failed to delete order';
      const status = error.message === 'Order not found' ? 404 : 500;
      res.status(status).json({ message });
    }
  });

  // `POST /api/orders/bulk` and `handleOrderBulk` (server/lib/bulkActionHandler.ts)
  // are removed here — no caller after PR1 replaced Open Orders' bulk toolbar
  // with the board (brief, Cleanup).
}
