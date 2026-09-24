/**
 * Staff Performance (v1.2 Phase 7B) — the "engine" half.
 *
 * Reads orders, their board events, lines and refunds for a range and hands
 * them to the pure maths in `shared/reports/staffPerformance.ts`. The viewer
 * rule (Q14) is applied here, on the server: admins and the owner see every
 * row, a manager sees cashiers and themselves. Rows a viewer may not see are
 * left out of the list but stay in the Total, so the Total is still the whole
 * business's figure.
 *
 * Phase 8's usage and friction data never feeds this (owner): only orders,
 * order events and refunds are read.
 */
import { and, eq, gte, inArray, isNull, lt, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { allowedUsers, customers, orderEvents, orderItems, orders, organizations, refunds } from "@shared/schema";
import {
  computeStaffPerformance,
  changePercent,
  isPerformanceProvisional,
  previousPeriod,
  provisionalUntil,
  splitValueBroughtIn,
  type PerformanceActivity,
  type PerformanceFigures,
  type PerformanceOrder,
  type PerformancePerson,
  type PerformanceRow,
} from "@shared/reports/staffPerformance";
import { currentTradingDay, shiftIsoDate, tradingDayBounds, tradingDayFor } from "@shared/time/tradingDay";
import { orgTimeZone } from "./tradingDayShift";
import { mayFilterEvidenceBy, type EvidenceViewer } from "./evidenceStaff";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SETTLED = "completed";
const PERSONAL_USE = "personal_use";
/** Statuses an order is no longer "open" in, for Still open. */
const CLOSED_STATUSES = ["completed", "cancelled", "refunded", "voided"];
const MAX_RANGE_DAYS = 400;
const TREND_WEEKS = 8;
const DETAIL_ORDER_LIMIT = 500;

export class PerformanceError extends Error {
  constructor(message: string, public status: 400 | 403 | 404) {
    super(message);
  }
}

export interface PerformanceFilters {
  locationId?: string | null;
  fulfilment?: "collection" | "delivery" | null;
  channel?: string | null;
}

export interface PerformanceQuery extends PerformanceFilters {
  fromIso: string;
  toIso: string;
  /** Which person rows to list. Null lists cashiers and managers. */
  role?: "CASHIER" | "MANAGER" | null;
  /** Show the Admin cover line. It is always in the Total. */
  adminCover?: boolean;
}

/** Parses and checks the query string. Throws PerformanceError(400) on nonsense. */
export function parsePerformanceQuery(q: Record<string, unknown>, timeZone: string): PerformanceQuery {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const today = currentTradingDay(timeZone);
  const toIso = str(q.to) ?? today;
  const fromIso = str(q.from) ?? shiftIsoDate(toIso, -6);
  if (!ISO_DAY.test(fromIso) || !ISO_DAY.test(toIso)) throw new PerformanceError("Dates must be YYYY-MM-DD.", 400);
  if (fromIso > toIso) throw new PerformanceError("From must be on or before To.", 400);
  const span = (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000;
  if (span > MAX_RANGE_DAYS) throw new PerformanceError(`Pick a range of ${MAX_RANGE_DAYS} days or fewer.`, 400);
  const fulfilment = str(q.fulfilment);
  if (fulfilment && fulfilment !== "collection" && fulfilment !== "delivery") {
    throw new PerformanceError("Fulfilment is collection or delivery.", 400);
  }
  const role = str(q.role);
  if (role && role !== "CASHIER" && role !== "MANAGER") throw new PerformanceError("Role is CASHIER or MANAGER.", 400);
  const locationId = str(q.locationId);
  if (locationId && !/^[0-9a-f-]{36}$/i.test(locationId)) throw new PerformanceError("Location not found.", 404);
  return {
    fromIso,
    toIso,
    locationId,
    fulfilment: fulfilment as PerformanceQuery["fulfilment"],
    channel: str(q.channel),
    role: role as PerformanceQuery["role"],
    adminCover: q.adminCover !== "0" && q.adminCover !== "false",
  };
}

function orderFilterConditions(filters: PerformanceFilters): SQL[] {
  const out: SQL[] = [];
  if (filters.locationId) out.push(eq(orders.locationId, filters.locationId));
  if (filters.fulfilment) out.push(eq(orders.fulfilmentMethod, filters.fulfilment));
  if (filters.channel) out.push(eq(orders.channel, filters.channel));
  return out;
}

function subjectOf(row: { authUserId: string | null; replitUserId: string }): string {
  return row.authUserId || row.replitUserId;
}

/**
 * The org's logins, by user id: members of the org plus the org-less
 * SUPER_ADMIN owner (who steps in on the till too). Customers never.
 */
export async function loadPeople(orgId: string): Promise<Map<string, PerformancePerson>> {
  const rows = await db
    .select({
      authUserId: allowedUsers.authUserId,
      replitUserId: allowedUsers.replitUserId,
      name: allowedUsers.name,
      role: allowedUsers.role,
    })
    .from(allowedUsers)
    .where(
      and(
        ne(allowedUsers.role, "CUSTOMER"),
        or(eq(allowedUsers.orgId, orgId), and(isNull(allowedUsers.orgId), eq(allowedUsers.role, "SUPER_ADMIN"))),
      ),
    );
  const people = new Map<string, PerformancePerson>();
  for (const r of rows) {
    const role = String(r.role ?? "CASHIER");
    people.set(subjectOf(r), { name: r.name?.trim() || `Unnamed ${role.toLowerCase()}`, role });
  }
  return people;
}

interface LoadedOrder extends PerformanceOrder {
  settledAt: Date;
  customerId: string | null;
}

/** Counted orders: completed, settled in [start, end), not personal use. */
async function loadCountedOrders(orgId: string, start: Date, end: Date, filters: PerformanceFilters): Promise<LoadedOrder[]> {
  const rows = await db
    .select({
      id: orders.id,
      value: sql<string>`coalesce(${orders.settledTotal}, ${orders.total})`,
      fulfilment: orders.fulfilmentMethod,
      channel: orders.channel,
      loaderId: orders.inputUserId,
      completerId: orders.completedUserId,
      assigneeId: orders.assignedUserId,
      settledAt: orders.settledAt,
      customerId: orders.customerId,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        eq(orders.status, SETTLED),
        gte(orders.settledAt, start),
        lt(orders.settledAt, end),
        ne(orders.paymentMethod, PERSONAL_USE),
        ...orderFilterConditions(filters),
      ),
    );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [events, lineRows, wrongRows] = await Promise.all([
    db
      .select({ orderId: orderEvents.orderId, kind: orderEvents.kind, userId: orderEvents.userId })
      .from(orderEvents)
      .where(
        and(eq(orderEvents.orgId, orgId), inArray(orderEvents.orderId, ids), inArray(orderEvents.kind, ["ready", "out_for_delivery"])),
      )
      .orderBy(orderEvents.orderId, orderEvents.at),
    db
      .select({
        orderId: orderItems.orderId,
        items: sql<string>`coalesce(sum(${orderItems.quantity}), 0)`,
        lines: sql<number>`count(*)::int`,
      })
      .from(orderItems)
      .where(inArray(orderItems.orderId, ids))
      .groupBy(orderItems.orderId),
    db
      .selectDistinct({ orderId: refunds.orderId })
      .from(refunds)
      .where(and(eq(refunds.orgId, orgId), inArray(refunds.orderId, ids), eq(refunds.reason, "wrong_item"))),
  ]);

  // Ascending by `at`, so the last write is the most recent — an order marked
  // ready, unreadied and readied again credits whoever readied it last.
  const preparer = new Map<string, string | null>();
  const dispatcher = new Map<string, string | null>();
  for (const e of events) {
    if (e.kind === "ready") preparer.set(e.orderId, e.userId);
    else dispatcher.set(e.orderId, e.userId);
  }
  const lines = new Map(lineRows.map((l) => [l.orderId as string, { items: Number(l.items) || 0, lines: l.lines }]));
  const wrong = new Set(wrongRows.map((w) => w.orderId));

  return rows.map((r) => ({
    id: r.id,
    value: Number(r.value) || 0,
    fulfilment: r.fulfilment === "delivery" ? "delivery" : "collection",
    channel: r.channel ?? "pos",
    loaderId: r.loaderId ?? null,
    completerId: r.completerId ?? null,
    preparerId: preparer.get(r.id) ?? null,
    dispatcherId: dispatcher.get(r.id) ?? null,
    assigneeId: r.assigneeId ?? null,
    items: lines.get(r.id)?.items ?? 0,
    lines: lines.get(r.id)?.lines ?? 0,
    wrongItem: wrong.has(r.id),
    settledAt: r.settledAt as Date,
    customerId: r.customerId ?? null,
  }));
}

/** Everything a person did in the range that is not a counted order. */
async function loadActivity(
  orgId: string,
  start: Date,
  end: Date,
  filters: PerformanceFilters,
): Promise<Map<string, Partial<PerformanceActivity>>> {
  const activity = new Map<string, Partial<PerformanceActivity>>();
  const bump = (userId: string | null | undefined, key: keyof PerformanceActivity, by = 1) => {
    if (!userId) return;
    const a = activity.get(userId) ?? {};
    a[key] = (a[key] ?? 0) + by;
    activity.set(userId, a);
  };
  const filterConds = orderFilterConditions(filters);

  const [eventRows, deleteRows, refundRows, openRows] = await Promise.all([
    // Reopens and unready taps on orders that still exist (joined for the filters).
    db
      .select({ kind: orderEvents.kind, userId: orderEvents.userId, meta: orderEvents.meta })
      .from(orderEvents)
      .innerJoin(orders, eq(orders.id, orderEvents.orderId))
      .where(
        and(
          eq(orderEvents.orgId, orgId),
          inArray(orderEvents.kind, ["reopened", "unready"]),
          gte(orderEvents.at, start),
          lt(orderEvents.at, end),
          ...filterConds,
        ),
      ),
    // A deleted order is gone, so only its recorded fulfilment can be filtered on.
    db
      .select({ userId: orderEvents.userId, meta: orderEvents.meta })
      .from(orderEvents)
      .where(and(eq(orderEvents.orgId, orgId), eq(orderEvents.kind, "deleted"), gte(orderEvents.at, start), lt(orderEvents.at, end))),
    db
      .select({
        userId: refunds.cashierId,
        count: sql<number>`count(*)::int`,
        value: sql<string>`coalesce(sum(${refunds.total}), 0)`,
      })
      .from(refunds)
      .innerJoin(orders, eq(orders.id, refunds.orderId))
      .where(and(eq(refunds.orgId, orgId), gte(refunds.createdAt, start), lt(refunds.createdAt, end), ...filterConds))
      .groupBy(refunds.cashierId),
    db
      .select({ userId: orders.inputUserId, count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.orgId, orgId),
          sql`${orders.inputUserId} IS NOT NULL`,
          gte(sql`coalesce(${orders.enteredAt}, ${orders.createdAt})`, start),
          lt(sql`coalesce(${orders.enteredAt}, ${orders.createdAt})`, end),
          or(isNull(orders.status), notInArray(orders.status, CLOSED_STATUSES)),
          ne(orders.paymentMethod, PERSONAL_USE),
          ...filterConds,
        ),
      )
      .groupBy(orders.inputUserId),
  ]);

  for (const e of eventRows) {
    if (e.kind === "unready") bump(e.userId, "unreadyTaps");
    // A reopen counts against the person whose completion was undone, not
    // the manager who reopened it.
    else bump((e.meta as { completedUserId?: string } | null)?.completedUserId, "reopens");
  }
  for (const d of deleteRows) {
    const f = (d.meta as { fulfilmentMethod?: string } | null)?.fulfilmentMethod;
    if (filters.fulfilment && f && f !== filters.fulfilment) continue;
    bump(d.userId, "deletes");
  }
  for (const r of refundRows) {
    bump(r.userId, "refundsProcessed", r.count);
    bump(r.userId, "refundsValue", Number(r.value) || 0);
  }
  for (const o of openRows) bump(o.userId, "stillOpen", o.count);
  return activity;
}

async function performanceSince(orgId: string): Promise<Date> {
  const [org] = await db
    .select({ since: organizations.staffPerformanceSince })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return org?.since ? new Date(org.since as unknown as string) : new Date(0);
}

export async function performanceProvisional(orgId: string, now = new Date()) {
  const since = await performanceSince(orgId);
  return { provisional: isPerformanceProvisional(since, now), until: provisionalUntil(since).toISOString() };
}

type Headline = Pick<PerformanceFigures, "completed" | "salesCompleted" | "valueBroughtIn" | "loaded" | "prepared">;
const HEADLINE_KEYS: (keyof Headline)[] = ["completed", "salesCompleted", "valueBroughtIn", "loaded", "prepared"];

function headline(f: PerformanceFigures | undefined): Headline {
  return {
    completed: f?.completed ?? 0,
    salesCompleted: f?.salesCompleted ?? 0,
    valueBroughtIn: f?.valueBroughtIn ?? 0,
    loaded: f?.loaded ?? 0,
    prepared: f?.prepared ?? 0,
  };
}

function changes(current: PerformanceFigures, previous: Headline): Record<keyof Headline, number | null> {
  const out = {} as Record<keyof Headline, number | null>;
  for (const k of HEADLINE_KEYS) out[k] = changePercent(current[k], previous[k]);
  return out;
}

export type PerformanceRowOut = PerformanceRow & {
  previous: Headline;
  change: Record<keyof Headline, number | null>;
};

export interface StaffPerformanceResponse {
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  provisional: boolean;
  provisionalUntil: string;
  filters: PerformanceQuery;
  rows: PerformanceRowOut[];
  /** People who worked in the range but are above the viewer's line (Q14): in the Total, not listed. */
  hiddenPeople: number;
  team: {
    total: PerformanceFigures & { previous: Headline; change: Record<keyof Headline, number | null> };
    adminCover: PerformanceFigures | null;
    unattributed: PerformanceFigures;
  };
  grossSettledSales: number;
  channels: string[];
}

async function computeFor(orgId: string, timeZone: string, fromIso: string, toIso: string, filters: PerformanceFilters, people: Map<string, PerformancePerson>) {
  const start = tradingDayBounds(fromIso, timeZone).start;
  const end = tradingDayBounds(toIso, timeZone).end;
  const [counted, activity] = await Promise.all([loadCountedOrders(orgId, start, end, filters), loadActivity(orgId, start, end, filters)]);
  return { counted, result: computeStaffPerformance(counted, people, activity) };
}

export async function staffPerformance(
  orgId: string,
  query: PerformanceQuery,
  viewer: EvidenceViewer,
): Promise<StaffPerformanceResponse> {
  const timeZone = await orgTimeZone(orgId);
  const people = await loadPeople(orgId);
  const prev = previousPeriod(query.fromIso, query.toIso);
  const [current, previous, prov, channelRows] = await Promise.all([
    computeFor(orgId, timeZone, query.fromIso, query.toIso, query, people),
    computeFor(orgId, timeZone, prev.from, prev.to, query, people),
    performanceProvisional(orgId),
    db.selectDistinct({ channel: orders.channel }).from(orders).where(eq(orders.orgId, orgId)),
  ]);

  const prevByUser = new Map(previous.result.rows.map((r) => [r.userId, r]));
  let hiddenPeople = 0;
  const rows: PerformanceRowOut[] = [];
  for (const row of current.result.rows) {
    if (!mayFilterEvidenceBy(viewer, { id: row.userId, role: row.role })) {
      hiddenPeople += 1;
      continue;
    }
    if (query.role && row.role !== query.role) continue;
    const p = headline(prevByUser.get(row.userId));
    rows.push({ ...row, previous: p, change: changes(row, p) });
  }

  const prevTotal = headline(previous.result.total);
  return {
    period: { from: query.fromIso, to: query.toIso },
    previousPeriod: prev,
    provisional: prov.provisional,
    provisionalUntil: prov.until,
    filters: query,
    rows,
    hiddenPeople,
    team: {
      total: { ...current.result.total, previous: prevTotal, change: changes(current.result.total, prevTotal) },
      adminCover: query.adminCover === false ? null : current.result.adminCover,
      unattributed: current.result.unattributed,
    },
    grossSettledSales: current.result.grossSettledSales,
    channels: channelRows.map((c) => c.channel).filter((c): c is string => Boolean(c)).sort(),
  };
}

// ------------------------------------------------------------- drill-down

export interface PerformanceDetailOrder {
  orderId: string;
  ref: string;
  settledAt: string;
  fulfilment: "collection" | "delivery";
  channel: string;
  value: number;
  jobs: ("loaded" | "prepared" | "completed" | "dispatched")[];
  valueBroughtIn: number;
  /** Name only — never a phone or email (PRV-03). */
  customerName: string | null;
}

export interface PerformanceDetailResponse {
  person: { userId: string; name: string; role: string };
  period: { from: string; to: string };
  provisional: boolean;
  provisionalUntil: string;
  figures: PerformanceFigures;
  trend: Array<{ weekStart: string; weekEnd: string; completed: number; salesCompleted: number; valueBroughtIn: number; loaded: number; prepared: number }>;
  orders: PerformanceDetailOrder[];
  ordersTruncated: boolean;
}

function mondayOf(iso: string): string {
  const dow = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
  return shiftIsoDate(iso, -dow);
}

export async function staffPerformanceDetail(
  orgId: string,
  userId: string,
  query: PerformanceQuery,
  viewer: EvidenceViewer,
): Promise<PerformanceDetailResponse> {
  const people = await loadPeople(orgId);
  const person = people.get(userId);
  // Unknown first, then forbidden: an id that names nobody here is a 404
  // whoever asks, so a refusal never confirms someone exists.
  if (!person) throw new PerformanceError("Staff member not found.", 404);
  if (!mayFilterEvidenceBy(viewer, { id: userId, role: person.role })) {
    throw new PerformanceError("You can see cashiers' figures and your own.", 403);
  }

  // Admins are Admin cover and never get a row of their own; their
  // drill-down is still their own figures, so here they are listed.
  const asListed = new Map(people);
  asListed.set(userId, { ...person, role: "CASHIER" });

  const timeZone = await orgTimeZone(orgId);
  const [{ counted, result }, prov] = await Promise.all([
    computeFor(orgId, timeZone, query.fromIso, query.toIso, query, asListed),
    performanceProvisional(orgId),
  ]);
  const figures: PerformanceFigures =
    result.rows.find((r) => r.userId === userId) ?? computeStaffPerformance([], people).total;

  // 8-week trend: the eight Monday-to-Sunday weeks ending with the one `to` falls in.
  const lastMonday = mondayOf(query.toIso);
  const firstMonday = shiftIsoDate(lastMonday, -7 * (TREND_WEEKS - 1));
  const trendStart = tradingDayBounds(firstMonday, timeZone).start;
  const trendEnd = tradingDayBounds(shiftIsoDate(lastMonday, 6), timeZone).end;
  const trendOrders = await loadCountedOrders(orgId, trendStart, trendEnd, query);
  const trend = [];
  for (let w = 0; w < TREND_WEEKS; w++) {
    const weekStart = shiftIsoDate(firstMonday, 7 * w);
    const weekEnd = shiftIsoDate(weekStart, 6);
    const weekOrders = trendOrders.filter((o) => {
      const day = tradingDayFor(o.settledAt, timeZone);
      return day >= weekStart && day <= weekEnd;
    });
    const row = computeStaffPerformance(weekOrders, asListed).rows.find((r) => r.userId === userId);
    trend.push({
      weekStart,
      weekEnd,
      completed: row?.completed ?? 0,
      salesCompleted: row?.salesCompleted ?? 0,
      valueBroughtIn: row?.valueBroughtIn ?? 0,
      loaded: row?.loaded ?? 0,
      prepared: row?.prepared ?? 0,
    });
  }

  const mine = counted
    .filter((o) => [o.loaderId, o.preparerId, o.completerId, o.dispatcherId].includes(userId))
    .sort((a, b) => b.settledAt.getTime() - a.settledAt.getTime());
  const shown = mine.slice(0, DETAIL_ORDER_LIMIT);
  const customerIds = [...new Set(shown.map((o) => o.customerId).filter((c): c is string => Boolean(c)))];
  const names = new Map<string, string>();
  if (customerIds.length) {
    const rows = await db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.orgId, orgId), inArray(customers.id, customerIds)));
    for (const c of rows) if (c.name) names.set(c.id, c.name);
  }

  return {
    person: { userId, name: person.name, role: person.role },
    period: { from: query.fromIso, to: query.toIso },
    provisional: prov.provisional,
    provisionalUntil: prov.until,
    figures,
    trend,
    orders: shown.map((o) => {
      const jobs: PerformanceDetailOrder["jobs"] = [];
      if (o.loaderId === userId) jobs.push("loaded");
      if (o.preparerId === userId) jobs.push("prepared");
      if (o.completerId === userId) jobs.push("completed");
      if (o.dispatcherId === userId) jobs.push("dispatched");
      const split = splitValueBroughtIn(Math.round(o.value * 100), o.completerId, o.loaderId);
      const pence = (o.completerId === userId ? split.completerPence : 0) + (o.loaderId === userId && o.loaderId !== o.completerId ? split.loaderPence : 0);
      return {
        orderId: o.id,
        ref: o.id.slice(0, 8),
        settledAt: o.settledAt.toISOString(),
        fulfilment: o.fulfilment,
        channel: o.channel,
        value: o.value,
        jobs,
        valueBroughtIn: pence / 100,
        customerName: o.customerId ? (names.get(o.customerId) ?? null) : null,
      };
    }),
    ordersTruncated: mine.length > shown.length,
  };
}
