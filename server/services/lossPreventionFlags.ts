/**
 * Loss-prevention flags (v1.2 Phase 7C, STF-09) — the "engine" half.
 *
 * Counts each measure in shared/reports/lossPrevention.ts per person per
 * week over the week being judged and the 8 before it, applies the rule
 * there (3+ events and at least twice the person's baseline, or top 5%), and
 * raises each flag into Needs a look as a "pattern" exception. Needs a look's
 * own rule routes it: cashiers' to managers and admins, managers' to admins
 * only, never to the person themselves.
 *
 * Idempotent: a flag's source id is derived from (org, person, measure,
 * week), and the inbox ignores a replayed source.
 */
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { tradingDayBounds, tradingDayFor, shiftIsoDate } from "@shared/time/tradingDay";
import {
  LP_BASELINE_WEEKS,
  LP_METRICS,
  LP_METRIC_KEYS,
  decideFlag,
  flagSummary,
  topThreshold,
  type LpMetric,
  type LpWeek,
} from "@shared/reports/lossPrevention";
import { PERFORMANCE_ROW_ROLES } from "@shared/reports/staffPerformance";
import type { Role } from "@shared/rbac";
import { orgTimeZone } from "./tradingDayShift";
import { loadPeople } from "./staffPerformance";
import { raiseExceptionReview } from "./exceptionReviews";
import { notify } from "./signals";

type Executor = typeof db | any;

/** A stable uuid for a flag, so the weekly job can run twice and raise it once. */
export function flagSourceId(orgId: string, userId: string, metric: string, weekStart: string): string {
  const h = createHash("sha1").update(`staff_pattern:${orgId}:${userId}:${metric}:${weekStart}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

interface Hit {
  userId: string | null;
  at: Date | string;
}

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

/** Every measure's events in [start, end), as (user, instant) — plus the discount rows. */
async function loadHits(orgId: string, start: Date, end: Date, client: Executor) {
  const q = async (query: ReturnType<typeof sql>) => rowsOf(await client.execute(query)) as Hit[];
  const hits: Partial<Record<LpMetric, Hit[]>> = {};
  const [refundRows, wrongRows, eventRows, personal, exceptions, others, dupes, minSold, selfPaid, settings, discountRows] = await Promise.all([
    q(sql`SELECT cashier_id AS "userId", created_at AS at, refund_method AS method FROM refunds
          WHERE org_id = ${orgId} AND created_at >= ${start} AND created_at < ${end}`),
    // A wrong item is on whoever picked it: the last person to mark it ready, else whoever completed it.
    q(sql`SELECT coalesce((SELECT e.user_id FROM order_events e WHERE e.order_id = r.order_id AND e.kind = 'ready'
                           ORDER BY e.at DESC LIMIT 1), o.completed_user_id) AS "userId", r.created_at AS at
          FROM refunds r JOIN orders o ON o.id = r.order_id
          WHERE r.org_id = ${orgId} AND r.reason = 'wrong_item' AND r.created_at >= ${start} AND r.created_at < ${end}`),
    q(sql`SELECT user_id AS "userId", at, kind FROM order_events
          WHERE org_id = ${orgId} AND kind IN ('deleted', 'reopened', 'unready', 'edited') AND at >= ${start} AND at < ${end}`),
    q(sql`SELECT coalesce(input_user_id, completed_user_id) AS "userId", coalesce(settled_at, created_at) AS at FROM orders
          WHERE org_id = ${orgId} AND payment_method = 'personal_use'
            AND coalesce(settled_at, created_at) >= ${start} AND coalesce(settled_at, created_at) < ${end}`),
    q(sql`SELECT user_id AS "userId", created_at AS at FROM price_exceptions
          WHERE org_id = ${orgId} AND created_at >= ${start} AND created_at < ${end}`),
    q(sql`SELECT completed_user_id AS "userId", settled_at AS at FROM orders
          WHERE org_id = ${orgId} AND status = 'completed' AND settled_at >= ${start} AND settled_at < ${end}
            AND assigned_user_id IS NOT NULL AND completed_user_id IS NOT NULL AND assigned_user_id <> completed_user_id`),
    q(sql`SELECT c.created_by_user_id AS "userId", c.created_at AS at FROM customers c
          WHERE c.org_id = ${orgId} AND c.created_by_user_id IS NOT NULL AND c.created_at >= ${start} AND c.created_at < ${end}
            AND (c.possible_duplicate_of IS NOT NULL OR EXISTS (
                   SELECT 1 FROM customers d WHERE d.org_id = c.org_id AND d.id <> c.id AND c.phone_e164 IS NOT NULL
                      AND d.phone_e164 = c.phone_e164 AND d.created_at < c.created_at))`),
    // A minimum lowered, then a sale by the same person below the old minimum within 7 days.
    q(sql`SELECT DISTINCT ON (h.id, o.id) h.changed_by AS "userId", coalesce(o.entered_at, o.created_at) AS at
          FROM product_price_history h
          JOIN order_items oi ON oi.product_id = h.product_id
          JOIN orders o ON o.id = oi.order_id AND o.org_id = h.org_id
          WHERE h.org_id = ${orgId} AND h.field = 'min' AND h.changed_by IS NOT NULL
            AND h.new_value < h.old_value AND oi.unit_price < h.old_value
            AND (o.input_user_id = h.changed_by OR o.completed_user_id = h.changed_by)
            AND coalesce(o.entered_at, o.created_at) >= h.created_at
            AND coalesce(o.entered_at, o.created_at) < h.created_at + interval '7 days'
            AND coalesce(o.entered_at, o.created_at) >= ${start} AND coalesce(o.entered_at, o.created_at) < ${end}`),
    q(sql`SELECT user_id AS "userId", created_at AS at FROM cashier_commission_payments
          WHERE org_id = ${orgId} AND user_id IS NOT NULL AND confirmed_by_user_id = user_id
            AND created_at >= ${start} AND created_at < ${end}`),
    q(sql`SELECT actor_user_id AS "userId", created_at AS at FROM admin_audit_logs
          WHERE org_id = ${orgId} AND action IN ('org.pay_setting.changed', 'org.timing_setting.changed', 'staff_targets.set')
            AND created_at >= ${start} AND created_at < ${end}`),
    rowsOf(
      await client.execute(sql`SELECT coalesce(input_user_id, completed_user_id) AS "userId", settled_at AS at,
          coalesce(tier_discount, 0) + coalesce(promo_discount, 0) + coalesce(points_discount, 0) AS discount, subtotal
        FROM orders
        WHERE org_id = ${orgId} AND status = 'completed' AND payment_method <> 'personal_use' AND subtotal IS NOT NULL
          AND settled_at >= ${start} AND settled_at < ${end}`),
    ) as Array<Hit & { discount: string; subtotal: string }>,
  ]);
  hits.refunds = refundRows;
  hits.cashRefunds = refundRows.filter((r: any) => r.method === "cash");
  hits.wrongItemRefunds = wrongRows;
  hits.deletes = eventRows.filter((e: any) => e.kind === "deleted");
  hits.reopens = eventRows.filter((e: any) => e.kind === "reopened");
  hits.unreadyTaps = eventRows.filter((e: any) => e.kind === "unready");
  hits.afterSaleEdits = eventRows.filter((e: any) => e.kind === "edited");
  hits.personalUse = personal;
  hits.priceExceptions = exceptions;
  hits.completedOthers = others;
  hits.duplicateCustomers = dupes;
  hits.minLoweredThenSold = minSold;
  hits.selfConfirmedCommission = selfPaid;
  hits.settingChanges = settings;
  return { hits, discountRows };
}

async function loadWorkedWeeks(orgId: string, fromIso: string, toIso: string, client: Executor) {
  const rows = rowsOf(
    await client.execute(sql`SELECT user_id AS "userId", trading_day::text AS day FROM cashier_shifts
      WHERE org_id = ${orgId} AND user_id IS NOT NULL AND trading_day >= ${fromIso} AND trading_day <= ${toIso}`),
  ) as Array<{ userId: string; day: string }>;
  return rows;
}

export interface RaisedFlag {
  userId: string;
  metric: LpMetric;
  summary: string;
  exceptionId: string;
}

/**
 * Judges `week` (Monday to Sunday trading days) for every cashier and
 * manager and raises the flags. Returns only flags raised by this call.
 */
export async function raiseLossPreventionFlags(
  orgId: string,
  week: { from: string; to: string },
  client: Executor = db,
): Promise<RaisedFlag[]> {
  const timeZone = await orgTimeZone(orgId);
  const firstMonday = shiftIsoDate(week.from, -7 * LP_BASELINE_WEEKS);
  const start = tradingDayBounds(firstMonday, timeZone).start;
  const end = tradingDayBounds(week.to, timeZone).end;
  const weekIndex = (at: Date | string) => {
    const day = tradingDayFor(new Date(at), timeZone);
    return Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${firstMonday}T00:00:00Z`)) / (7 * 86_400_000));
  };
  const WEEKS = LP_BASELINE_WEEKS + 1;
  const current = WEEKS - 1;

  const people = await loadPeople(orgId);
  const subjects = [...people].filter(([, p]) => (PERFORMANCE_ROW_ROLES as readonly string[]).includes(p.role));
  if (subjects.length === 0) return [];
  const [{ hits, discountRows }, shifts] = await Promise.all([
    loadHits(orgId, start, end, client),
    loadWorkedWeeks(orgId, firstMonday, week.to, client),
  ]);

  // Weeks each person worked: a daily shift, or anything counted here.
  const worked = new Map<string, Set<number>>();
  const markWorked = (userId: string | null, idx: number) => {
    if (!userId || idx < 0 || idx >= WEEKS) return;
    const set = worked.get(userId) ?? new Set<number>();
    set.add(idx);
    worked.set(userId, set);
  };
  for (const s of shifts) markWorked(s.userId, weekIndex(`${s.day}T12:00:00Z`));

  // measure -> user -> per-week figures
  const table = new Map<LpMetric, Map<string, LpWeek[]>>();
  const cell = (metric: LpMetric, userId: string, idx: number): LpWeek => {
    let byUser = table.get(metric);
    if (!byUser) table.set(metric, (byUser = new Map()));
    let weeks = byUser.get(userId);
    if (!weeks) byUser.set(userId, (weeks = Array.from({ length: WEEKS }, () => ({ events: 0, value: 0 }))));
    return weeks[idx];
  };
  for (const metric of LP_METRIC_KEYS) {
    if (metric === "discountPercent") continue;
    for (const h of hits[metric] ?? []) {
      if (!h.userId) continue;
      const idx = weekIndex(h.at);
      if (idx < 0 || idx >= WEEKS) continue;
      const c = cell(metric, h.userId, idx);
      c.events += 1;
      c.value += 1;
      markWorked(h.userId, idx);
    }
  }
  // Discount %: discounted sales are the events; the week's value is discount ÷ subtotal.
  const discountSums = new Map<string, Array<{ discount: number; subtotal: number }>>();
  for (const d of discountRows) {
    if (!d.userId) continue;
    const idx = weekIndex(d.at);
    if (idx < 0 || idx >= WEEKS) continue;
    const list = discountSums.get(d.userId) ?? Array.from({ length: WEEKS }, () => ({ discount: 0, subtotal: 0 }));
    list[idx].discount += Number(d.discount) || 0;
    list[idx].subtotal += Number(d.subtotal) || 0;
    discountSums.set(d.userId, list);
    const c = cell("discountPercent", d.userId, idx);
    if ((Number(d.discount) || 0) > 0) c.events += 1;
    markWorked(d.userId, idx);
  }
  for (const [userId, list] of discountSums) {
    list.forEach((w, idx) => {
      cell("discountPercent", userId, idx).value = w.subtotal > 0 ? (w.discount / w.subtotal) * 100 : 0;
    });
  }

  const weekLabel = new Date(`${week.from}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const raised: RaisedFlag[] = [];
  for (const metric of LP_METRIC_KEYS) {
    const byUser = table.get(metric) ?? new Map<string, LpWeek[]>();
    // Every worked person-week in the window, zero where nothing happened.
    const population: number[] = [];
    for (const [userId] of subjects) {
      const weeks = byUser.get(userId);
      for (const idx of worked.get(userId) ?? []) population.push(weeks?.[idx]?.value ?? 0);
    }
    const top = topThreshold(population);
    for (const [userId, person] of subjects) {
      const weeks = byUser.get(userId);
      if (!weeks) continue;
      const thisWeek = weeks[current];
      const previous = [...(worked.get(userId) ?? [])].filter((i) => i < current).map((i) => weeks[i]);
      const decision = decideFlag(thisWeek, previous, top);
      if (!decision.flagged) continue;
      const summary = `${person.name} — ${flagSummary(metric, weekLabel, thisWeek, decision)}`;
      const exceptionId = await raiseExceptionReview(client, {
        orgId,
        kind: "pattern",
        sourceId: flagSourceId(orgId, userId, metric, week.from),
        orderId: null,
        subjectUserId: userId,
        subjectRole: person.role as Role,
        severity: "warning",
        summary,
        amount: null,
        rules: {
          metric,
          label: LP_METRICS[metric].label,
          weekStart: week.from,
          events: thisWeek.events,
          value: Math.round(thisWeek.value * 100) / 100,
          baseline: decision.baseline == null ? null : Math.round(decision.baseline * 100) / 100,
          reason: decision.reason,
        },
      });
      if (!exceptionId) continue; // already raised by an earlier run
      raised.push({ userId, metric, summary, exceptionId });
      // Names the person, so it reaches only people who outrank them.
      await notify(
        {
          orgId,
          title: "Needs a look",
          message: `A pattern to look at for ${person.name}: ${LP_METRICS[metric].label.toLowerCase()}.`,
          severity: "warning",
          source: "staff_pattern",
          subjectUserId: userId,
          metadata: { entityId: exceptionId, weekStart: week.from, metric },
        },
        client,
      );
    }
  }
  return raised;
}
