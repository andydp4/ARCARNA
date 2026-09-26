/**
 * Staff Performance 7C (benefit, speed, fairness) — the "engine" half.
 *
 * Reads what the pure maths in shared/reports/staffBenefit.ts,
 * staffSpeed.ts and staffFairness.ts need for a range and hands it over,
 * keyed by login. Called by Staff Performance (Evidence), My performance and
 * the weekly digest, so all three read the same facts by the same rule.
 *
 * Phase 8's usage and friction data never feeds this (owner): only orders,
 * their events, lines, refunds, credit, customers, price exceptions, personal
 * alerts and the daily shift record are read.
 */
import { and, eq, gte, inArray, isNotNull, lt, lte, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  adminAuditLogs,
  cashierCommissionEntries,
  cashierShifts,
  creditPayments,
  customers,
  opsAlerts,
  orderCredit,
  orderItems,
  orders,
  priceExceptions,
  refunds,
  satisfactionScores,
} from "@shared/schema";
import { computeBenefit, emptyBenefit, type BenefitFigures, type BenefitOrder, type BenefitSideFacts } from "@shared/reports/staffBenefit";
import { computeSpeed, emptySpeed, teamSpeed, type AlertAck, type SpeedFigures, type SpeedOrder } from "@shared/reports/staffSpeed";
import { activeTime, fairnessRates, type FairnessRates, type ShiftSpan } from "@shared/reports/staffFairness";
import { deriveOrderTiming } from "@shared/reports/orderTiming";
import type { KpiSource } from "@shared/reports/staffTargets";
import { splitValueBroughtIn, type PerformanceFigures } from "@shared/reports/staffPerformance";
import { tradingDayBounds } from "@shared/time/tradingDay";
import { loadOrderTimingInputs } from "./reportsEngine";
import type { LoadedOrder, PerformanceFilters } from "./staffPerformance";

const PERSONAL_USE = "personal_use";

export interface SettingsInForce {
  now: { prepSlaMinutes: number; deliveryLeadMinutes: number; lateGraceMinutes: number; timezone: string };
  /** Changes made since the start of the range: what applied before them is `from`. */
  changes: Array<{ setting: string; from: unknown; to: unknown; at: string }>;
}

export interface PeopleExtras {
  benefit: Map<string | null, BenefitFigures>;
  speed: Map<string | null, SpeedFigures>;
  teamSpeed: SpeedFigures;
  /**
   * Team speed with the given people's work left out: for a viewer who may
   * not see them (Q14), so team minus listed rows does not give them away.
   */
  teamSpeedWithout: (hidden: ReadonlySet<string>) => SpeedFigures;
  active: Map<string, { activeHours: number; daysWorked: number }>;
  ordersHandled: Map<string, number>;
  /** Information only (STF-11): stars on orders each person completed. */
  satisfaction: Map<string, { average: number; count: number }>;
  settingsInForce: SettingsInForce;
}

function filterConds(filters: PerformanceFilters): SQL[] {
  const out: SQL[] = [];
  if (filters.locationId) out.push(eq(orders.locationId, filters.locationId));
  if (filters.fulfilment) out.push(eq(orders.fulfilmentMethod, filters.fulfilment));
  if (filters.channel) out.push(eq(orders.channel, filters.channel));
  return out;
}

const num = (v: unknown) => Number(v) || 0;

function bump(map: Map<string, Partial<BenefitSideFacts>>, userId: string | null | undefined, key: keyof BenefitSideFacts, by: number) {
  if (!userId || !by) return;
  const s = map.get(userId) ?? {};
  s[key] = (s[key] ?? 0) + by;
  map.set(userId, s);
}

/** Benefit's non-order facts for the range. */
async function loadBenefitSide(orgId: string, start: Date, end: Date, fromIso: string, toIso: string, filters: PerformanceFilters) {
  const side = new Map<string, Partial<BenefitSideFacts>>();
  const conds = filterConds(filters);
  const [newCustomers, recovered, badDebt, exceptions, refundRows, personal] = await Promise.all([
    db
      .select({ userId: customers.createdByUserId, n: sql<number>`count(*)::int` })
      .from(customers)
      .where(and(eq(customers.orgId, orgId), isNotNull(customers.createdByUserId), gte(customers.createdAt, start), lt(customers.createdAt, end)))
      .groupBy(customers.createdByUserId),
    db
      .select({ userId: creditPayments.recordedByUserId, total: sql<string>`coalesce(sum(${creditPayments.amount}), 0)` })
      .from(creditPayments)
      .innerJoin(orders, eq(orders.id, creditPayments.orderId))
      .where(and(eq(creditPayments.orgId, orgId), gte(creditPayments.paidOn, fromIso), lte(creditPayments.paidOn, toIso), ...conds))
      .groupBy(creditPayments.recordedByUserId),
    // Bad debt is charged to whoever gave the credit: the person who took the sale.
    db
      .select({
        userId: sql<string | null>`coalesce(${orders.inputUserId}, ${orders.completedUserId})`,
        given: orderCredit.amountGiven,
        paid: sql<string>`coalesce((SELECT sum(cp.amount) FROM credit_payments cp WHERE cp.order_id = ${orderCredit.orderId}), 0)`,
      })
      .from(orderCredit)
      .innerJoin(orders, eq(orders.id, orderCredit.orderId))
      .where(
        and(
          eq(orderCredit.orgId, orgId),
          eq(orderCredit.status, "written_off"),
          gte(orderCredit.updatedAt, start),
          lt(orderCredit.updatedAt, end),
          ...conds,
        ),
      ),
    db
      .select({ userId: priceExceptions.userId, total: sql<string>`coalesce(sum(${priceExceptions.underCost}), 0)` })
      .from(priceExceptions)
      .innerJoin(orders, eq(orders.id, priceExceptions.orderId))
      .where(and(eq(priceExceptions.orgId, orgId), gte(priceExceptions.createdAt, start), lt(priceExceptions.createdAt, end), ...conds))
      .groupBy(priceExceptions.userId),
    db
      .select({ total: refunds.total, completerId: orders.completedUserId, loaderId: orders.inputUserId })
      .from(refunds)
      .innerJoin(orders, eq(orders.id, refunds.orderId))
      .where(and(eq(refunds.orgId, orgId), gte(refunds.createdAt, start), lt(refunds.createdAt, end), ...conds)),
    db
      .select({
        userId: sql<string | null>`coalesce(${orders.inputUserId}, ${orders.completedUserId})`,
        cost: sql<string>`coalesce(sum(${orderItems.unitCost} * ${orderItems.quantity}), 0)`,
      })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orders.orgId, orgId),
          eq(orders.paymentMethod, PERSONAL_USE),
          gte(sql`coalesce(${orders.settledAt}, ${orders.createdAt})`, start),
          lt(sql`coalesce(${orders.settledAt}, ${orders.createdAt})`, end),
          ...conds,
        ),
      )
      .groupBy(sql`coalesce(${orders.inputUserId}, ${orders.completedUserId})`),
  ]);

  for (const r of newCustomers) bump(side, r.userId, "newCustomers", r.n);
  for (const r of recovered) bump(side, r.userId, "creditRecovered", num(r.total));
  for (const r of badDebt) bump(side, r.userId, "badDebtOriginated", Math.max(0, num(r.given) - num(r.paid)));
  for (const r of exceptions) bump(side, r.userId, "priceExceptionCost", num(r.total));
  for (const r of refundRows) {
    // Refund cost follows the sale it came off, split like the sale's value.
    const split = splitValueBroughtIn(Math.round(num(r.total) * 100), r.completerId ?? null, r.loaderId ?? null);
    bump(side, r.completerId, "refundCost", split.completerPence / 100);
    bump(side, r.loaderId, "refundCost", split.loaderPence / 100);
  }
  for (const r of personal) bump(side, r.userId, "personalUseCost", num(r.cost));
  return side;
}

async function loadBenefitOrders(orgId: string, counted: readonly LoadedOrder[]): Promise<BenefitOrder[]> {
  if (counted.length === 0) return [];
  const ids = counted.map((o) => o.id);
  const [lineRows, discountRows] = await Promise.all([
    db
      .select({ orderId: orderItems.orderId, total: orderItems.totalPrice, quantity: orderItems.quantity, unitCost: orderItems.unitCost })
      .from(orderItems)
      .where(inArray(orderItems.orderId, ids)),
    db
      .select({
        id: orders.id,
        discount: sql<string>`coalesce(${orders.tierDiscount}, 0) + coalesce(${orders.promoDiscount}, 0) + coalesce(${orders.pointsDiscount}, 0)`,
      })
      .from(orders)
      .where(inArray(orders.id, ids)),
  ]);
  const lines = new Map<string, BenefitOrder["lines"]>();
  for (const l of lineRows) {
    if (!l.orderId) continue;
    const list = lines.get(l.orderId) ?? [];
    list.push({ total: num(l.total), quantity: num(l.quantity), unitCost: l.unitCost == null ? null : num(l.unitCost) });
    lines.set(l.orderId, list);
  }
  const discount = new Map(discountRows.map((d) => [d.id, num(d.discount)]));
  return counted.map((o) => ({
    id: o.id,
    loaderId: o.loaderId,
    completerId: o.completerId,
    discount: discount.get(o.id) ?? 0,
    hasCustomer: Boolean(o.customerId),
    lines: lines.get(o.id) ?? [],
  }));
}

async function loadSpeed(orgId: string, start: Date, end: Date, filters: PerformanceFilters) {
  const { inputs, settings, people } = await loadOrderTimingInputs(orgId, start, new Date(end.getTime() - 1));
  const speedOrders: SpeedOrder[] = [];
  for (const input of inputs) {
    const who = people.get(input.id);
    if (filters.fulfilment && input.fulfilmentMethod !== filters.fulfilment) continue;
    if (filters.channel && input.channel !== filters.channel) continue;
    if (filters.locationId && who?.locationId !== filters.locationId) continue;
    const fact = deriveOrderTiming(input, settings);
    const readyAt = input.readyAt ? new Date(input.readyAt) : null;
    const handoverAt = input.handoverAt ? new Date(input.handoverAt) : input.settledAt ? new Date(input.settledAt) : null;
    speedOrders.push({
      fact,
      loaderId: input.inputUserId,
      preparerId: who?.preparerId ?? null,
      dispatcherId: who?.dispatcherId ?? null,
      assigneeId: input.assignedUserId,
      completerId: input.completedUserId,
      receivedAt: new Date(input.enteredAt ?? input.createdAt),
      readyAt,
      handoverAt,
      firstPromiseAt: who?.firstPromiseAt ? new Date(who.firstPromiseAt) : null,
      delays: who?.delays ?? [],
      delayNotifiedAt: who?.delayNotifiedAt ? new Date(who.delayNotifiedAt) : null,
      // A counter sale: collected, completed, and nobody ever marked it ready.
      instant: input.fulfilmentMethod === "collection" && input.status === "completed" && readyAt == null && !who?.preparerId,
    });
  }

  const alertRows = await db
    .select({ userId: opsAlerts.userId, createdAt: opsAlerts.createdAt, ackedAt: opsAlerts.ackedAt })
    .from(opsAlerts)
    .where(
      and(
        eq(opsAlerts.orgId, orgId),
        isNotNull(opsAlerts.ackedAt),
        sql`${opsAlerts.ackedByUserId} = ${opsAlerts.userId}`,
        gte(opsAlerts.createdAt, start),
        lt(opsAlerts.createdAt, end),
      ),
    );
  const alerts: AlertAck[] = alertRows.map((a) => ({
    userId: a.userId,
    minutes: (new Date(a.ackedAt as unknown as string).getTime() - new Date(a.createdAt as unknown as string).getTime()) / 60_000,
  }));
  const teamWithout = (hidden: ReadonlySet<string>): SpeedFigures => {
    if (hidden.size === 0) return teamSpeed(speedOrders, settings, alerts);
    const isHidden = (u: string | null) => u != null && hidden.has(u);
    const visibleOrders = speedOrders
      .filter((o) => ![o.loaderId, o.preparerId, o.dispatcherId, o.assigneeId, o.completerId].some(isHidden))
      .map((o) => ({ ...o, delays: o.delays.filter((d) => !isHidden(d.userId)) }));
    return teamSpeed(visibleOrders, settings, alerts.filter((a) => !isHidden(a.userId)));
  };
  return { speed: computeSpeed(speedOrders, settings, alerts), team: teamSpeed(speedOrders, settings, alerts), teamWithout, settings };
}

export async function loadActiveTime(orgId: string, fromIso: string, toIso: string, userId?: string) {
  const rows = await db
    .select({
      userId: cashierShifts.userId,
      tradingDay: sql<string>`${cashierShifts.tradingDay}::text`,
      openedAt: cashierShifts.openedAt,
      lastActivityAt: cashierShifts.lastActivityAt,
    })
    .from(cashierShifts)
    .where(
      and(
        eq(cashierShifts.orgId, orgId),
        isNotNull(cashierShifts.userId),
        gte(cashierShifts.tradingDay, fromIso),
        lte(cashierShifts.tradingDay, toIso),
        ...(userId ? [eq(cashierShifts.userId, userId)] : []),
      ),
    );
  const byUser = new Map<string, ShiftSpan[]>();
  for (const r of rows) {
    if (!r.userId) continue;
    const list = byUser.get(r.userId) ?? [];
    list.push({
      tradingDay: r.tradingDay,
      openedAt: new Date(r.openedAt as unknown as string),
      lastActivityAt: new Date(r.lastActivityAt as unknown as string),
    });
    byUser.set(r.userId, list);
  }
  const out = new Map<string, { activeHours: number; daysWorked: number }>();
  for (const [u, spans] of byUser) out.set(u, activeTime(spans));
  return out;
}

async function loadSatisfaction(orgId: string, counted: readonly LoadedOrder[]) {
  const out = new Map<string, { average: number; count: number }>();
  if (counted.length === 0) return out;
  const completer = new Map(counted.map((o) => [o.id, o.completerId]));
  const rows = await db
    .select({ orderId: satisfactionScores.orderId, score: satisfactionScores.score })
    .from(satisfactionScores)
    .where(and(eq(satisfactionScores.orgId, orgId), inArray(satisfactionScores.orderId, counted.map((o) => o.id))));
  const sums = new Map<string, { sum: number; count: number }>();
  for (const r of rows) {
    const who = r.orderId ? completer.get(r.orderId) : null;
    if (!who) continue;
    const s = sums.get(who) ?? { sum: 0, count: 0 };
    s.sum += r.score;
    s.count += 1;
    sums.set(who, s);
  }
  for (const [u, s] of sums) out.set(u, { average: Math.round((s.sum / s.count) * 100) / 100, count: s.count });
  return out;
}

async function loadSettingsChanges(orgId: string, start: Date) {
  const rows = await db
    .select({ metadata: adminAuditLogs.metadata, createdAt: adminAuditLogs.createdAt })
    .from(adminAuditLogs)
    .where(and(eq(adminAuditLogs.orgId, orgId), eq(adminAuditLogs.action, "org.timing_setting.changed"), gte(adminAuditLogs.createdAt, start)))
    .orderBy(adminAuditLogs.createdAt)
    .limit(50);
  return rows.map((r) => {
    const m = (r.metadata ?? {}) as { setting?: string; from?: unknown; to?: unknown };
    return { setting: String(m.setting ?? ""), from: m.from ?? null, to: m.to ?? null, at: new Date(r.createdAt as unknown as string).toISOString() };
  });
}

/** Distinct counted orders each person did any job on — the "per 10 orders" base. */
export function ordersHandledBy(counted: readonly LoadedOrder[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of counted) {
    for (const u of new Set([o.loaderId, o.preparerId, o.completerId, o.dispatcherId])) {
      if (u) out.set(u, (out.get(u) ?? 0) + 1);
    }
  }
  return out;
}

export async function loadPeopleExtras(
  orgId: string,
  timeZone: string,
  fromIso: string,
  toIso: string,
  counted: readonly LoadedOrder[],
  filters: PerformanceFilters,
  opts: { benefit: boolean } = { benefit: true },
): Promise<PeopleExtras> {
  const start = tradingDayBounds(fromIso, timeZone).start;
  const end = tradingDayBounds(toIso, timeZone).end;
  const [benefitOrders, side, speed, active, satisfaction, changes] = await Promise.all([
    opts.benefit ? loadBenefitOrders(orgId, counted) : Promise.resolve([]),
    opts.benefit ? loadBenefitSide(orgId, start, end, fromIso, toIso, filters) : Promise.resolve(new Map()),
    loadSpeed(orgId, start, end, filters),
    loadActiveTime(orgId, fromIso, toIso),
    loadSatisfaction(orgId, counted),
    loadSettingsChanges(orgId, start),
  ]);
  return {
    benefit: opts.benefit ? computeBenefit(benefitOrders, side) : new Map(),
    speed: speed.speed,
    teamSpeed: speed.team,
    teamSpeedWithout: speed.teamWithout,
    active,
    ordersHandled: ordersHandledBy(counted),
    satisfaction,
    settingsInForce: {
      now: {
        prepSlaMinutes: speed.settings.prepSlaMinutes,
        deliveryLeadMinutes: speed.settings.deliveryLeadMinutes,
        lateGraceMinutes: speed.settings.lateGraceMinutes,
        timezone: speed.settings.timezone,
      },
      changes,
    },
  };
}

/** A person's fairness rates from their 7B figures and active time. */
export function ratesFor(userId: string, figures: PerformanceFigures, extras: Pick<PeopleExtras, "active" | "ordersHandled">): FairnessRates {
  const t = extras.active.get(userId) ?? { activeHours: 0, daysWorked: 0 };
  return fairnessRates({
    activeHours: t.activeHours,
    daysWorked: t.daysWorked,
    ordersHandled: extras.ordersHandled.get(userId) ?? 0,
    jobs: figures.loaded + figures.prepared + figures.completed + figures.dispatched,
    completed: figures.completed,
    valueBroughtIn: figures.valueBroughtIn,
    refundsProcessed: figures.refundsProcessed,
    reopens: figures.reopens,
    deletes: figures.deletes,
    unreadyTaps: figures.unreadyTaps,
    wrongItemOrders: figures.wrongItemOrders,
  });
}

/** Commission accrued to a person in the range (their own figure; reversals included). */
export async function commissionFor(orgId: string, userId: string, fromIso: string, toIso: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${cashierCommissionEntries.amount}), 0)` })
    .from(cashierCommissionEntries)
    .where(
      and(
        eq(cashierCommissionEntries.orgId, orgId),
        eq(cashierCommissionEntries.userId, userId),
        gte(cashierCommissionEntries.accruedOn, fromIso),
        lte(cashierCommissionEntries.accruedOn, toIso),
      ),
    );
  return Math.round(num(row?.total) * 100) / 100;
}

// ------------------------------------------------------------ per person


/** Everything targets and badges read for one person. Carries no cost. */
export function kpiSourceFor(userId: string, figures: PerformanceFigures, extras: PeopleExtras): KpiSource & { figures: PerformanceFigures; rates: FairnessRates } {
  const benefit = extras.benefit.get(userId) ?? emptyBenefit();
  return {
    figures,
    speed: extras.speed.get(userId) ?? emptySpeed(),
    rates: ratesFor(userId, figures, extras),
    namedCustomerCapturePercent: benefit.namedCustomerCapturePercent,
    ordersTaken: benefit.ordersTaken,
  };
}
