import { z } from "zod";
import { API_ROUTE_WORDS } from "./apiRouteWords";
import { isDeviceName, screenFor, UNNAMED_DEVICE, VERSION_RE } from "./problemReports";
import { shiftIsoDate } from "./time/tradingDay";

/**
 * Our own usage record and Friction Truths (v1.2 Phase 8B/8C: UXA-07, UXA-08,
 * UXA-13).
 *
 * Pure rules shared by the till (what it records and sends) and the server
 * (what it accepts, how it scores). The server applies every rule again: the
 * till is not trusted to have done it.
 *
 * What is recorded: screen views with active time, the titles of messages
 * staff see, slow (over 1.5 s) and failed calls, crashes, time offline and
 * the steps of a sale. What is NEVER recorded: screen text, anything typed,
 * money amounts or names. Events carry a role and a device name, never who
 * (owner decision Q18): no user id is sent, stored or joined, anywhere.
 */

// ---------------------------------------------------------------------------
// What counts.
// ---------------------------------------------------------------------------

/** A screen counts as in use when there was input in the last 30 s and the tab is visible. */
export const ACTIVE_WINDOW_MS = 30_000;
/** A call slower than this is recorded as slow. */
export const SLOW_CALL_MS = 1_500;

/** Raw events are kept 90 days; daily summaries 24 months. */
export const RAW_RETENTION_DAYS = 90;
export const SUMMARY_RETENTION_MONTHS = 24;

/** Most events in one batch, and per device per hour (the tills share one address, so the limit is per device). */
export const USAGE_BATCH_MAX = 200;
export const DEVICE_EVENTS_PER_HOUR = 1_500;
/**
 * And per shop per hour, whatever the device keys. The device key is the
 * till's own word (nothing checks it), so a build that makes a new key on
 * every load, or a session that sends a fresh key each batch, would otherwise
 * get a fresh device allowance every time. A busy shop's tills send a few
 * hundred events an hour each; this is several times that.
 */
export const ORG_EVENTS_PER_HOUR = 10_000;
/** A batch kept offline is still accepted up to this old; older events are dropped. */
export const USAGE_MAX_AGE_DAYS = 30;

/** Friction Truths ranks nothing until this many days of data exist ("not enough data yet"). */
export const ENOUGH_DATA_DAYS = 14;
/** The Monday top five is held back until three weeks of data exist. */
export const WEEKLY_MIN_DAYS = 21;
/** Local hour on Monday from which the top five is sent. */
export const WEEKLY_HOUR = 8;
/** A screen needs this much use in the window before it is ranked (a few minutes would make any error look huge). */
export const MIN_SCORED_HOURS = 0.5;

/**
 * Always-on screens. Nobody touches the board, so "active time" there is
 * near zero and would make every slow call look enormous. These are scored
 * per OPEN hour (tab visible) and labelled "information screen".
 */
export const INFORMATION_SCREENS: readonly string[] = ["/operations"];
export const INFORMATION_SCREEN_LABEL = "information screen";

export function isInformationScreen(screen: string): boolean {
  return INFORMATION_SCREENS.includes(screen);
}

export const FUNNEL_STEPS = [
  { key: "start", label: "Started (first line)" },
  { key: "pay", label: "Opened Pay" },
  { key: "submit", label: "Pressed Complete" },
  { key: "done", label: "Sale placed" },
  { key: "failed", label: "Sale failed" },
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number]["key"];
const FUNNEL_KEYS = FUNNEL_STEPS.map((s) => s.key) as [FunnelStep, ...FunnelStep[]];

export const CRASH_KINDS = ["boundary", "script", "chunk"] as const;
export type CrashKind = (typeof CRASH_KINDS)[number];

/**
 * "Already owes" at order start (v1.2.1 credit): the till notes that it showed
 * the notice, and that a payment was taken from it. A count by role and
 * device, never the customer or the amount.
 */
export const CREDIT_NOTICE_STEPS = ["shown", "paid"] as const;
export type CreditNoticeStep = (typeof CREDIT_NOTICE_STEPS)[number];

export const USAGE_KINDS = ["screen", "message", "call", "crash", "offline", "funnel", "credit"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** What one incident costs a screen's pain score. Crashes hurt most; a slow call least. */
export const PAIN_WEIGHTS = {
  crash: 5,
  problem: 3,
  errorMessage: 2,
  failedCall: 2,
  slowCall: 1,
} as const;

// ---------------------------------------------------------------------------
// Shaping: routes, message titles.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_ID_RE = /^[0-9A-Za-z_-]{16,}$/;

/**
 * An API call as a route shape: `/api/orders/3f2a…/refund?x=1` is
 * `/api/orders/:id/refund`. Anything before `/api` (the app's base path, a
 * host) and the query string are dropped; a segment that is not one of the
 * server's route words (API_ROUTE_WORDS: a barcode, a gift card code, a
 * search) becomes `:value`.
 */
export function apiRouteShape(url: string): string {
  let p = String(url ?? "");
  const q = p.search(/[?#]/);
  if (q >= 0) p = p.slice(0, q);
  const at = p.indexOf("/api/");
  if (at < 0) return "/other";
  p = p.slice(at);
  const segments = p
    .split("/")
    .filter(Boolean)
    .slice(0, 6)
    .map((s, i) => {
      if (i === 0) return "api";
      if (UUID_RE.test(s) || /^\d+$/.test(s) || (LONG_ID_RE.test(s) && /\d/.test(s))) return ":id";
      // Only a word from the server's own routes is kept. A word-like segment
      // that is not one (a gift card code with no digit, a typed SKU such as
      // "abc-123") is something staff typed, so it is never stored.
      const word = s.toLowerCase();
      return API_ROUTE_WORDS.has(word) ? word : ":value";
    });
  return `/${segments.join("/")}`.slice(0, 100);
}

export const MESSAGE_TITLE_MAX = 80;

/**
 * A message's title as it may be stored. Almost every title is fixed text in
 * the code ("Order failed"); the few that are built from data are cut back so
 * no name, number, amount or reference is kept: anything after a dash (where
 * the data goes, as in "Refunded — order AB12", or after a colon or comma),
 * emails, quoted text and every word with a digit or £ in it. Blunt on
 * purpose: a lost word costs nothing, a kept name breaks the promise.
 */
export function scrubMessageTitle(title: string): string {
  let t = String(title ?? "").replace(/\s+/g, " ").trim();
  t = t.split(/\s[—–-]\s|[:,]\s/)[0];
  t = t
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "#")
    .replace(/["“][^"“”]*["”]|‘[^‘’]*’/g, "#")
    .split(" ")
    .map((w) => (/[\d£$€]/.test(w) ? "#" : w))
    .join(" ")
    .replace(/(#\s*)+/g, "# ")
    .trim();
  return t.slice(0, MESSAGE_TITLE_MAX);
}

// ---------------------------------------------------------------------------
// What the till sends. Strict: anything not listed is refused.
// ---------------------------------------------------------------------------

const at = z.string().datetime();
const screenIn = z.string().max(2000);
const ms = (max: number) => z.number().int().min(0).max(max);
const HOUR = 3_600_000;

export const usageEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("screen"),
      at,
      screen: screenIn,
      activeMs: ms(24 * HOUR),
      openMs: ms(24 * HOUR),
      /** More time on a view already counted (a long shift on one screen is sent in parts). */
      cont: z.boolean().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("message"), at, screen: screenIn, title: z.string().max(500), tone: z.enum(["error", "info"]) }).strict(),
  z
    .object({
      kind: z.literal("call"),
      at,
      screen: screenIn,
      method: z.enum(METHODS),
      route: z.string().max(2000),
      ms: ms(10 * 60_000),
      /** 0 = no answer (network). */
      status: z.number().int().min(0).max(599),
    })
    .strict(),
  z.object({ kind: z.literal("crash"), at, screen: screenIn, crash: z.enum(CRASH_KINDS) }).strict(),
  z.object({ kind: z.literal("offline"), at, screen: screenIn, ms: ms(7 * 24 * HOUR) }).strict(),
  z.object({ kind: z.literal("funnel"), at, screen: screenIn, step: z.enum(FUNNEL_KEYS) }).strict(),
  z.object({ kind: z.literal("credit"), at, screen: screenIn, step: z.enum(CREDIT_NOTICE_STEPS) }).strict(),
]);
export type UsageEventInput = z.infer<typeof usageEventSchema>;

export const usageBatchSchema = z
  .object({
    /** A random id this browser made for itself; only for the per-device limit and device health. */
    deviceKey: z.string().regex(/^[0-9A-Za-z_-]{8,64}$/),
    device: z.string().max(40).optional().nullable(),
    appVersion: z.string().max(40).optional().nullable(),
    events: z.array(usageEventSchema).min(1).max(USAGE_BATCH_MAX),
  })
  .strict();
export type UsageBatchInput = z.infer<typeof usageBatchSchema>;

/** A call is worth recording when it was slow, or failed. 401 is a signed-out session, not friction. */
export function isFrictionCall(msTaken: number, status: number): boolean {
  return msTaken > SLOW_CALL_MS || status === 0 || (status >= 400 && status !== 401);
}

export function isFailedStatus(status: number): boolean {
  return status === 0 || (status >= 400 && status !== 401);
}

/** A screen row's label when it is more time on a view already counted, so it is not counted as another view. */
export const SCREEN_CONTINUED = "cont";

/** One stored row. Note what is NOT here: no user, no text, no amounts. */
export type UsageRow = {
  kind: UsageKind;
  screen: string;
  label: string;
  activeMs: number;
  openMs: number;
  durationMs: number;
  slow: boolean;
  failed: boolean;
  occurredAt: Date;
};

/**
 * One event as it may be stored, or null when it is dropped (too old, from
 * the future, or a call that was neither slow nor failed).
 */
export function normaliseUsageEvent(e: UsageEventInput, now: Date): UsageRow | null {
  const when = new Date(e.at);
  if (!Number.isFinite(when.getTime())) return null;
  // A till's clock can be wrong; a little ahead is kept as now, far off is dropped.
  if (when.getTime() > now.getTime() + 5 * 60_000) return null;
  if (when.getTime() < now.getTime() - USAGE_MAX_AGE_DAYS * 86_400_000) return null;
  const occurredAt = when.getTime() > now.getTime() ? now : when;
  const base = { screen: screenFor(e.screen), label: "", activeMs: 0, openMs: 0, durationMs: 0, slow: false, failed: false, occurredAt };
  switch (e.kind) {
    case "screen":
      // Active time cannot exceed the time the screen was open.
      return { ...base, kind: "screen", label: e.cont ? SCREEN_CONTINUED : "", openMs: e.openMs, activeMs: Math.min(e.activeMs, e.openMs) };
    case "message": {
      const label = scrubMessageTitle(e.title);
      if (!label) return null;
      return { ...base, kind: "message", label, failed: e.tone === "error" };
    }
    case "call": {
      if (!isFrictionCall(e.ms, e.status)) return null;
      return {
        ...base,
        kind: "call",
        label: `${e.method} ${apiRouteShape(e.route)}`,
        durationMs: e.ms,
        slow: e.ms > SLOW_CALL_MS,
        failed: isFailedStatus(e.status),
      };
    }
    case "crash":
      return { ...base, kind: "crash", label: e.crash };
    case "offline":
      return { ...base, kind: "offline", screen: "", durationMs: e.ms };
    case "funnel":
      return { ...base, kind: "funnel", label: e.step };
    case "credit":
      return { ...base, kind: "credit", label: e.step };
  }
}

export function usageDevice(device: unknown): string {
  return isDeviceName(device) ? device : UNNAMED_DEVICE;
}

export function usageVersion(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return VERSION_RE.test(s) ? s : null;
}

// ---------------------------------------------------------------------------
// Scoring.
// ---------------------------------------------------------------------------

/** Per-screen totals over a window, from the daily summaries (and Problem? reports). */
export type ScreenTotals = {
  screen: string;
  activeMs: number;
  openMs: number;
  views: number;
  crashes: number;
  problems: number;
  errorMessages: number;
  failedCalls: number;
  slowCalls: number;
};

export type ScoredScreen = ScreenTotals & {
  information: boolean;
  /** Active hours, or open hours for an information screen. */
  hours: number;
  weighted: number;
  /** Pain per active (or open) hour; null when there was too little use to score. */
  painPerHour: number | null;
};

export function emptyTotals(screen: string): ScreenTotals {
  return { screen, activeMs: 0, openMs: 0, views: 0, crashes: 0, problems: 0, errorMessages: 0, failedCalls: 0, slowCalls: 0 };
}

export function weightedPain(t: ScreenTotals): number {
  return (
    t.crashes * PAIN_WEIGHTS.crash +
    t.problems * PAIN_WEIGHTS.problem +
    t.errorMessages * PAIN_WEIGHTS.errorMessage +
    t.failedCalls * PAIN_WEIGHTS.failedCall +
    t.slowCalls * PAIN_WEIGHTS.slowCall
  );
}

export function scoreScreen(t: ScreenTotals): ScoredScreen {
  const information = isInformationScreen(t.screen);
  const hours = (information ? t.openMs : t.activeMs) / HOUR;
  const weighted = weightedPain(t);
  const painPerHour = hours >= MIN_SCORED_HOURS ? Math.round((weighted / hours) * 100) / 100 : null;
  return { ...t, information, hours: Math.round(hours * 100) / 100, weighted, painPerHour };
}

/** Worst first; screens with too little use to score go last, most incidents first. */
export function painLeaderboard(totals: ScreenTotals[]): ScoredScreen[] {
  return totals
    .filter((t) => t.screen)
    .map(scoreScreen)
    .sort((a, b) => {
      if (a.painPerHour === null && b.painPerHour === null) return b.weighted - a.weighted;
      if (a.painPerHour === null) return 1;
      if (b.painPerHour === null) return -1;
      return b.painPerHour - a.painPerHour || b.weighted - a.weighted;
    });
}

// ---------------------------------------------------------------------------
// "Not enough data yet" and the Monday top five.
// ---------------------------------------------------------------------------

/** Days from the first day with data up to today (inclusive of neither end's partial-ness). */
export function daysOfData(firstDay: string | null, today: string): number {
  if (!firstDay) return 0;
  const a = Date.parse(`${firstDay}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function hasEnoughData(firstDay: string | null, today: string): boolean {
  return daysOfData(firstDay, today) >= ENOUGH_DATA_DAYS;
}

/** The week the Monday line reports on, for the Monday `weekStart` (ISO date). */
export function lastWeekRange(weekStart: string): { from: string; to: string } {
  return { from: shiftIsoDate(weekStart, -7), to: shiftIsoDate(weekStart, -1) };
}

/** Held back until 3 weeks of data exist before the week it is sent. */
export function weeklyAllowed(firstDay: string | null, weekStart: string): boolean {
  return daysOfData(firstDay, weekStart) >= WEEKLY_MIN_DAYS;
}

export type TopFiveEntry = {
  screen: string;
  information: boolean;
  why: "worst" | "rising";
  painPerHour: number;
  before: number | null;
  totals: ScreenTotals;
  hours: number;
};

/**
 * Five screens: the three worst last week, then the two fastest-rising
 * against the three weeks before (per active hour, so a busy week is not
 * mistaken for a worse one), topped up with the next worst.
 */
export function pickTopFive(lastWeek: ScreenTotals[], before: ScreenTotals[]): TopFiveEntry[] {
  const now = painLeaderboard(lastWeek).filter((s) => s.painPerHour !== null && s.weighted > 0);
  const prior = new Map(painLeaderboard(before).map((s) => [s.screen, s.painPerHour]));
  const entry = (s: ScoredScreen, why: TopFiveEntry["why"]): TopFiveEntry => ({
    screen: s.screen,
    information: s.information,
    why,
    painPerHour: s.painPerHour as number,
    before: prior.get(s.screen) ?? null,
    totals: s,
    hours: s.hours,
  });
  const out: TopFiveEntry[] = now.slice(0, 3).map((s) => entry(s, "worst"));
  const taken = new Set(out.map((e) => e.screen));
  const rising = now
    .filter((s) => !taken.has(s.screen))
    .map((s) => ({ s, rise: (s.painPerHour as number) - (prior.get(s.screen) ?? 0) }))
    .filter((r) => r.rise > 0)
    .sort((a, b) => b.rise - a.rise)
    .slice(0, 2);
  for (const r of rising) {
    out.push(entry(r.s, "rising"));
    taken.add(r.s.screen);
  }
  for (const s of now) {
    if (out.length >= 5) break;
    if (!taken.has(s.screen)) {
      out.push(entry(s, "worst"));
      taken.add(s.screen);
    }
  }
  return out.slice(0, 5);
}

function n(v: number, one: string, many = `${one}s`): string {
  return `${v} ${v === 1 ? one : many}`;
}

/** The raw numbers behind a score, in words. */
export function rawNumbers(t: ScreenTotals, hours: number, information: boolean): string {
  const parts = [
    t.crashes ? n(t.crashes, "crash", "crashes") : "",
    t.problems ? n(t.problems, "Problem? report") : "",
    t.errorMessages ? n(t.errorMessages, "error message") : "",
    t.failedCalls ? n(t.failedCalls, "failed call") : "",
    t.slowCalls ? n(t.slowCalls, "slow call") : "",
  ].filter(Boolean);
  return `${parts.join(", ") || "no incidents"} in ${hours.toFixed(1)} ${information ? "open" : "active"} hours`;
}

export function topFiveLine(e: TopFiveEntry, i: number): string {
  const label = e.information ? `${e.screen} (${INFORMATION_SCREEN_LABEL})` : e.screen;
  const per = e.information ? "per open hour" : "per active hour";
  const trend = e.before === null ? "new this week" : e.why === "rising" ? `rising from ${e.before.toFixed(1)}` : `was ${e.before.toFixed(1)}`;
  return `${i + 1}. ${label}: ${e.painPerHour.toFixed(1)} ${per} (${rawNumbers(e.totals, e.hours, e.information)}; ${trend})`;
}

export type FixCheck = {
  screen: string;
  version: string | null;
  beforePerHour: number | null;
  afterPerHour: number | null;
  reportsSince: number;
};

/** "Fixed last week: did it work?" in one line. */
export function fixCheckLine(f: FixCheck): string {
  const what = `${f.screen}${f.version ? ` (fixed in ${f.version})` : ""}`;
  if (f.afterPerHour === null) return `${what}: too little use since the fix to tell yet.`;
  const since = f.reportsSince ? `; ${n(f.reportsSince, "Problem? report")} since` : "";
  if (f.beforePerHour === null) return `${what}: ${f.afterPerHour.toFixed(1)} per hour since the fix, nothing to compare with${since}.`;
  const worked = f.afterPerHour <= f.beforePerHour * 0.5 && f.reportsSince === 0;
  return `${what}: ${worked ? "it worked" : "not yet"}, ${f.beforePerHour.toFixed(1)} to ${f.afterPerHour.toFixed(1)} per hour${since}.`;
}

// ---------------------------------------------------------------------------
// Improvement study window (the "on demand" recorder, NOT connected).
// ---------------------------------------------------------------------------

/** A window may run at most 14 days, on at most five chosen screens. */
export const STUDY_MAX_DAYS = 14;
export const STUDY_MAX_SCREENS = 5;

export const studyWindowSchema = z
  .object({
    enabled: z.boolean(),
    screens: z.array(z.string().max(200)).max(STUDY_MAX_SCREENS),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  })
  .strict();
export type StudyWindowInput = z.infer<typeof studyWindowSchema>;

export type StudyWindow = { enabled: boolean; screens: string[]; endsOn: string | null };

/** Validate a window against today; returns the problem in words, or null. */
export function studyWindowProblem(w: StudyWindowInput, today: string): string | null {
  if (!w.enabled) return null;
  if (w.screens.length === 0) return "Choose at least one screen for the study.";
  if (!w.endsOn) return "Choose the day the study ends.";
  if (w.endsOn < today) return "The end date has already passed.";
  if (w.endsOn > shiftIsoDate(today, STUDY_MAX_DAYS)) return `A study may run at most ${STUDY_MAX_DAYS} days.`;
  return null;
}

export function normaliseStudyWindow(w: StudyWindowInput): StudyWindow {
  const screens = [...new Set(w.screens.map((s) => screenFor(s)).filter((s) => s !== "/"))].slice(0, STUDY_MAX_SCREENS);
  return { enabled: w.enabled, screens, endsOn: w.endsOn };
}

export function studyActiveOn(w: StudyWindow | null | undefined, screen: string, today: string): boolean {
  if (!w?.enabled || !w.endsOn || w.endsOn < today) return false;
  return w.screens.includes(screen);
}

export function studyBannerText(endsOn: string): string {
  return `Improvement study on this screen until ${endsOn}`;
}
