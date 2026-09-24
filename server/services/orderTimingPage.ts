/**
 * The Order Timing page (v1.2 Phase 7A, STF-04): the tested timing engine
 * (`shared/reports/orderTiming.ts` + `loadOrderTimingFacts`) grouped by
 * fulfilment, assignee, completer, loader, hour, day or channel, with names.
 *
 * Person groupings follow Q14 on the server: a manager sees cashiers and
 * themselves; groups for anyone above that are left out (counted in
 * `hiddenGroups`) but stay in the whole-team summary. While per-person
 * figures are new (the first two weeks, owner) they are marked provisional.
 */
import {
  ORDER_TIMING_PAGE_GROUPS,
  PERSON_TIMING_GROUPS,
  engineGroupKey,
  groupOrderTiming,
  orderTimingRedFlags,
  summarizeOrderTiming,
  type OrderTimingPageGroup,
  type OrderTimingSummary,
} from "@shared/reports/orderTiming";
import { currentTradingDay, shiftIsoDate, tradingDayBounds } from "@shared/time/tradingDay";
import { loadOrderTimingFacts } from "./reportsEngine";
import { orgTimeZone } from "./tradingDayShift";
import { mayFilterEvidenceBy, type EvidenceViewer } from "./evidenceStaff";
import { loadPeople, performanceProvisional, PerformanceError } from "./staffPerformance";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const NO_PERSON_LABEL: Record<string, string> = {
  "(unassigned)": "Nobody claimed it",
  "(not yet completed)": "Not completed yet",
  "(no loader recorded)": "No loader (website or system)",
};

export interface OrderTimingPageResponse {
  period: { from: string; to: string };
  groupBy: OrderTimingPageGroup;
  summary: OrderTimingSummary;
  groups: Array<{ key: string; label: string; role: string | null; summary: OrderTimingSummary }>;
  hiddenGroups: number;
  redFlags: string[];
  provisional: boolean;
  provisionalUntil: string;
  settings: { prepSlaMinutes: number; deliveryLeadMinutes: number; lateGraceMinutes: number; timezone: string };
}

export function parseTimingQuery(q: Record<string, unknown>, timeZone: string) {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const toIso = str(q.to) ?? currentTradingDay(timeZone);
  const fromIso = str(q.from) ?? shiftIsoDate(toIso, -6);
  if (!ISO_DAY.test(fromIso) || !ISO_DAY.test(toIso)) throw new PerformanceError("Dates must be YYYY-MM-DD.", 400);
  if (fromIso > toIso) throw new PerformanceError("From must be on or before To.", 400);
  const group = str(q.groupBy) ?? "fulfilment";
  if (!(ORDER_TIMING_PAGE_GROUPS as readonly string[]).includes(group)) {
    throw new PerformanceError(`Group by one of: ${ORDER_TIMING_PAGE_GROUPS.join(", ")}.`, 400);
  }
  return { fromIso, toIso, groupBy: group as OrderTimingPageGroup };
}

const HOUR_LABEL = (key: string) => `${key}:00–${key}:59`;

export async function orderTimingPage(
  orgId: string,
  query: { fromIso: string; toIso: string; groupBy: OrderTimingPageGroup },
  viewer: EvidenceViewer,
): Promise<OrderTimingPageResponse> {
  const timeZone = await orgTimeZone(orgId);
  const start = tradingDayBounds(query.fromIso, timeZone).start;
  // loadOrderTimingFacts takes an inclusive `to`; stop a millisecond before the next trading day.
  const end = new Date(tradingDayBounds(query.toIso, timeZone).end.getTime() - 1);
  const [{ facts, settings }, prov] = await Promise.all([loadOrderTimingFacts(orgId, start, end), performanceProvisional(orgId)]);

  const isPerson = PERSON_TIMING_GROUPS.includes(query.groupBy);
  const people = isPerson ? await loadPeople(orgId) : new Map();
  let hiddenGroups = 0;
  const groups: OrderTimingPageResponse["groups"] = [];
  for (const g of groupOrderTiming(facts, engineGroupKey(query.groupBy))) {
    let label = g.key;
    let role: string | null = null;
    if (isPerson) {
      if (NO_PERSON_LABEL[g.key]) {
        label = NO_PERSON_LABEL[g.key];
      } else {
        const person = people.get(g.key);
        role = person?.role ?? null;
        if (!mayFilterEvidenceBy(viewer, { id: g.key, role })) {
          hiddenGroups += 1;
          continue;
        }
        label = person?.name ?? "Former member of staff";
      }
    } else if (query.groupBy === "hour") {
      label = HOUR_LABEL(g.key);
    } else if (query.groupBy === "fulfilment") {
      label = g.key === "delivery" ? "Delivery" : "Collection";
    }
    groups.push({ key: g.key, label, role, summary: g.summary });
  }
  if (isPerson) groups.sort((a, b) => a.label.localeCompare(b.label));

  const summary = summarizeOrderTiming(facts);
  return {
    period: { from: query.fromIso, to: query.toIso },
    groupBy: query.groupBy,
    summary,
    groups,
    hiddenGroups,
    redFlags: orderTimingRedFlags(summary),
    provisional: isPerson && prov.provisional,
    provisionalUntil: prov.until,
    settings: {
      prepSlaMinutes: settings.prepSlaMinutes,
      deliveryLeadMinutes: settings.deliveryLeadMinutes,
      lateGraceMinutes: settings.lateGraceMinutes,
      timezone: settings.timezone,
    },
  };
}
