/**
 * My performance and the weekly digest (v1.2 Phase 7C, STF-10).
 *
 * My performance is for every role and shows the person their OWN figures:
 * volume, value brought in, speed, fairness rates, KPIs against targets,
 * badges, commission and their own override count. Never anyone else's. A
 * team median is added only when 4 or more people worked in the range (Q14),
 * so nobody can work out a colleague's figure from it. No cost and no margin
 * are in it: it is served to cashiers (Q6).
 *
 * Today's figures are provisional (the day has not closed), and the response
 * is marked no-store so the device never keeps it.
 *
 * The weekly digest is built here too, for each recipient at the moment it is
 * sent (or opened): a cashier gets their own; a manager their own plus
 * cashiers' rows — never another manager's; admins and the owner everyone.
 * Nothing with a name and a figure is stored.
 */
import { currentTradingDay, shiftIsoDate, tradingDayBounds } from "@shared/time/tradingDay";
import { PERFORMANCE_ROW_ROLES, type PerformanceFigures } from "@shared/reports/staffPerformance";
import { teamMedian, type FairnessRates } from "@shared/reports/staffFairness";
import { kpisMetLabel, type KpiSummary } from "@shared/reports/staffTargets";
import type { Badge } from "@shared/reports/staffBadges";
import type { SpeedFigures } from "@shared/reports/staffSpeed";
import { isAtLeast } from "@shared/accessPolicy";
import { orgTimeZone } from "./tradingDayShift";
import { ownExceptionCount } from "./exceptionReviews";
import {
  PerformanceError,
  computeFor,
  loadPeople,
  peopleFiguresFor,
  performanceProvisional,
  targetsInForce,
  type TargetsInForce,
} from "./staffPerformance";
import { commissionFor, loadPeopleExtras, type SettingsInForce } from "./staffPeople";
import { emptyBenefit } from "@shared/reports/staffBenefit";

export interface TeamMedians {
  people: number;
  completed: number | null;
  valueBroughtIn: number | null;
  jobsPerActiveHour: number | null;
  collectionOnTimePercent: number | null;
  namedCustomerCapturePercent: number | null;
}

export interface MyPerformanceResponse {
  person: { userId: string; name: string; role: string };
  period: { from: string; to: string };
  /** The range includes today, which has not closed: its figures will move. */
  includesToday: boolean;
  provisional: boolean;
  provisionalUntil: string;
  figures: PerformanceFigures;
  speed: SpeedFigures;
  fairness: FairnessRates;
  namedCustomerCapturePercent: number | null;
  newCustomers: number;
  kpis: KpiSummary;
  kpisMet: string;
  badges: Badge[];
  satisfaction: { average: number; count: number } | null;
  commission: number;
  /** Q14: cashiers see their own override count. */
  overrideCount: number;
  teamMedian: TeamMedians | null;
  targets: { version: number; setAt: string; amberOnly: boolean } | null;
  settingsInForce: SettingsInForce;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseMyRange(q: Record<string, unknown>, timeZone: string): { fromIso: string; toIso: string } {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const today = currentTradingDay(timeZone);
  const toIso = str(q.to) ?? today;
  const fromIso = str(q.from) ?? toIso;
  if (!ISO_DAY.test(fromIso) || !ISO_DAY.test(toIso)) throw new PerformanceError("Dates must be YYYY-MM-DD.", 400);
  if (fromIso > toIso) throw new PerformanceError("From must be on or before To.", 400);
  if ((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000 > 400) {
    throw new PerformanceError("Pick a range of 400 days or fewer.", 400);
  }
  return { fromIso, toIso };
}

/** The whole team's figures for a range, every person listed (admins as themselves), plus the 7C extras. */
async function teamFor(orgId: string, fromIso: string, toIso: string) {
  const timeZone = await orgTimeZone(orgId);
  const people = await loadPeople(orgId);
  // List admins too, so an admin's own My performance has a row; the team
  // median below still only counts cashiers and managers.
  const listed = new Map([...people].map(([id, p]) => [id, { ...p, role: "CASHIER" }]));
  const [{ counted, result }, targets] = await Promise.all([
    computeFor(orgId, timeZone, fromIso, toIso, {}, listed),
    targetsInForce(orgId),
  ]);
  const extras = await loadPeopleExtras(orgId, timeZone, fromIso, toIso, counted, {});
  return { timeZone, people, rows: result.rows, extras, targets };
}

function medians(
  team: Awaited<ReturnType<typeof teamFor>>,
): TeamMedians | null {
  const members = team.rows.filter((r) => (PERFORMANCE_ROW_ROLES as readonly string[]).includes(team.people.get(r.userId)?.role ?? ""));
  const all = members.map((r) => peopleFiguresFor(r.userId, r, team.extras, team.targets));
  const completed = teamMedian(members.map((r) => r.completed));
  if (completed == null) return null;
  return {
    people: members.length,
    completed,
    valueBroughtIn: teamMedian(members.map((r) => r.valueBroughtIn)),
    jobsPerActiveHour: teamMedian(all.map((p) => p.fairness.jobsPerActiveHour)),
    collectionOnTimePercent: teamMedian(all.map((p) => p.speed.collectionOnTimePercent)),
    namedCustomerCapturePercent: teamMedian(all.map((p) => p.benefit.namedCustomerCapturePercent)),
  };
}

const publicTargets = (t: TargetsInForce | null) => (t ? { version: t.version, setAt: t.setAt, amberOnly: t.amberOnly } : null);

export async function myPerformance(
  orgId: string,
  viewer: { userId: string; role: string },
  range: { fromIso: string; toIso: string },
): Promise<MyPerformanceResponse> {
  const team = await teamFor(orgId, range.fromIso, range.toIso);
  const person = team.people.get(viewer.userId);
  const row = team.rows.find((r) => r.userId === viewer.userId);
  const figures = row ?? emptyFigures();
  const mine = peopleFiguresFor(viewer.userId, figures, team.extras, team.targets);
  const start = tradingDayBounds(range.fromIso, team.timeZone).start;
  const end = tradingDayBounds(range.toIso, team.timeZone).end;
  const [commission, overrideCount, prov] = await Promise.all([
    commissionFor(orgId, viewer.userId, range.fromIso, range.toIso),
    ownExceptionCount(orgId, viewer.userId, start, end, "price"),
    performanceProvisional(orgId),
  ]);
  const benefit = team.extras.benefit.get(viewer.userId) ?? emptyBenefit();
  return {
    person: { userId: viewer.userId, name: person?.name ?? "You", role: person?.role ?? viewer.role },
    period: { from: range.fromIso, to: range.toIso },
    includesToday: range.toIso >= currentTradingDay(team.timeZone),
    provisional: prov.provisional,
    provisionalUntil: prov.until,
    figures,
    speed: mine.speed,
    fairness: mine.fairness,
    // Only the non-cost parts of Benefit: a cashier never receives margin (Q6).
    namedCustomerCapturePercent: benefit.namedCustomerCapturePercent,
    newCustomers: benefit.newCustomers,
    kpis: mine.kpis,
    kpisMet: kpisMetLabel(mine.kpis),
    badges: mine.badges,
    satisfaction: mine.satisfaction,
    commission,
    overrideCount,
    teamMedian: medians(team),
    targets: publicTargets(team.targets),
    settingsInForce: team.extras.settingsInForce,
  };
}

function emptyFigures(): PerformanceFigures {
  return {
    loaded: 0,
    prepared: 0,
    completed: 0,
    collected: 0,
    delivered: 0,
    dispatched: 0,
    solo: 0,
    stillOpen: 0,
    salesCompleted: 0,
    valueBroughtIn: 0,
    averageOrderValue: null,
    itemsPerOrder: null,
    linesPerOrder: null,
    picked: 0,
    wrongItemOrders: 0,
    wrongItemRatePercent: null,
    reopens: 0,
    unreadyTaps: 0,
    refundsProcessed: 0,
    refundsValue: 0,
    deletes: 0,
    completedOthers: 0,
  };
}

// ------------------------------------------------------------- the digest

export interface DigestRow {
  userId: string;
  name: string;
  role: string;
  completed: number;
  valueBroughtIn: number;
  jobsPerActiveHour: number | null;
  kpisMet: string;
  badges: string[];
}

export interface WeeklyDigest {
  week: { from: string; to: string };
  recipient: { userId: string; name: string; role: string };
  own: DigestRow | null;
  commission: number;
  /** Rows the recipient may see (Q14). Empty for a cashier; cashiers only for a manager. */
  rows: DigestRow[];
  teamMedian: TeamMedians | null;
  targets: { version: number; setAt: string; amberOnly: boolean } | null;
}

/** The Monday of the week before the one `todayIso` falls in. */
export function lastWeekOf(todayIso: string): { from: string; to: string } {
  const dow = (new Date(`${todayIso}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = shiftIsoDate(todayIso, -dow);
  return { from: shiftIsoDate(monday, -7), to: shiftIsoDate(monday, -1) };
}

/** Which named rows a digest recipient may see: cashiers see none; managers cashiers; admins and the owner everyone. */
export function digestMaySee(recipient: { userId: string; role: string }, subject: { userId: string; role: string }): boolean {
  if (subject.userId === recipient.userId) return false; // their own is `own`, not a row
  if (!(PERFORMANCE_ROW_ROLES as readonly string[]).includes(subject.role)) return false;
  if (isAtLeast(recipient.role, "ADMIN")) return true;
  if (recipient.role === "MANAGER") return subject.role === "CASHIER";
  return false;
}

type Team = Awaited<ReturnType<typeof teamFor>>;

function digestRow(team: Team, userId: string): DigestRow | null {
  const row = team.rows.find((r) => r.userId === userId);
  const person = team.people.get(userId);
  if (!row || !person) return null;
  const p = peopleFiguresFor(userId, row, team.extras, team.targets);
  return {
    userId,
    name: person.name,
    role: person.role,
    completed: row.completed,
    valueBroughtIn: row.valueBroughtIn,
    jobsPerActiveHour: p.fairness.jobsPerActiveHour,
    kpisMet: kpisMetLabel(p.kpis),
    badges: p.badges.map((b) => b.label),
  };
}

/** Builds one recipient's digest from live figures. Callers must not store the result. */
export async function buildWeeklyDigest(
  orgId: string,
  recipient: { userId: string; role: string },
  week: { from: string; to: string },
  team?: Team,
): Promise<WeeklyDigest> {
  const t = team ?? (await teamFor(orgId, week.from, week.to));
  const rows: DigestRow[] = [];
  for (const r of t.rows) {
    const role = t.people.get(r.userId)?.role ?? "";
    if (!digestMaySee(recipient, { userId: r.userId, role })) continue;
    const d = digestRow(t, r.userId);
    if (d) rows.push(d);
  }
  // No ranking: alphabetical, never by a figure.
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return {
    week,
    recipient: { userId: recipient.userId, name: t.people.get(recipient.userId)?.name ?? "You", role: recipient.role },
    own: digestRow(t, recipient.userId),
    commission: await commissionFor(orgId, recipient.userId, week.from, week.to),
    rows,
    teamMedian: medians(t),
    targets: publicTargets(t.targets),
  };
}

/** Load the team once for a week, for building many recipients' digests. */
export const loadDigestTeam = teamFor;
