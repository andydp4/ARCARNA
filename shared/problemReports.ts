import { z } from "zod";

/**
 * The "Problem?" button (v1.2 Phase 8A: UXA-09, UXA-06, UXA-14).
 *
 * Pure rules shared by the sheet on the till and the server route, so what the
 * sheet offers and what the server accepts cannot drift. The server applies
 * every rule again: the till is not trusted to have done it.
 *
 * Privacy (owner decision Q18): a report carries the screen, role, device,
 * version, online status and queue counts, never a name. Sentry gets the chip
 * and the context only (never the free text, which staff may still fill with
 * a customer's details despite the hint), and the inbox shows the reporter's
 * role, not who they are. The reporter's id is kept only so "Thanks, fixed in
 * version X" can reach them.
 */

export const PROBLEM_CHIPS = [
  { key: "too_slow", label: "Too slow" },
  { key: "cant_find", label: "Can't find it" },
  { key: "wrong_thing", label: "Did the wrong thing" },
  { key: "error_message", label: "Error message" },
  { key: "other", label: "Other" },
] as const;

export type ProblemChip = (typeof PROBLEM_CHIPS)[number]["key"];
export const PROBLEM_CHIP_KEYS = PROBLEM_CHIPS.map((c) => c.key) as [ProblemChip, ...ProblemChip[]];

export function problemChipLabel(key: string): string {
  return PROBLEM_CHIPS.find((c) => c.key === key)?.label ?? key;
}

/**
 * Device names come from a fixed list, never typed: a typed name could be a
 * person's name, and a fixed list keeps Sentry's device tag to a known set.
 */
export const DEVICE_NAMES = [
  "Till 1",
  "Till 2",
  "Till 3",
  "Till 4",
  "Till 5",
  "Till 6",
  "Counter tablet",
  "Phone 1",
  "Phone 2",
  "Phone 3",
  "Phone 4",
  "Phone 5",
  "Phone 6",
] as const;

export type DeviceName = (typeof DEVICE_NAMES)[number];

/** Shown (and tagged) when nobody has named this device yet. */
export const UNNAMED_DEVICE = "Not named";

export function isDeviceName(value: unknown): value is DeviceName {
  return typeof value === "string" && (DEVICE_NAMES as readonly string[]).includes(value);
}

export const PROBLEM_NOTE_MAX = 1000;
export const PROBLEM_NOTE_HINT = "Don't type customer details.";

/** Reports one person may send in the rate window; beyond it the server says "slow down". */
export const PROBLEM_RATE_LIMIT = 10;
export const PROBLEM_RATE_WINDOW_MINUTES = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_ID_RE = /^[0-9A-Za-z_-]{16,}$/;

/**
 * The screen as a route shape, not a URL: ids become `:id` and the query
 * string is dropped (it can carry a search term or a customer's name), except
 * the Operations Centre's `pane`, which is how the till is told apart from the
 * board. So `/open-orders/3f2a…/refund` is `/open-orders/:id/refund` and
 * `/operations?pane=order&q=smith` is `/operations?pane=order`.
 */
export function screenFor(path: string, search = ""): string {
  let p = String(path ?? "").trim();
  let q = String(search ?? "");
  const qAt = p.indexOf("?");
  if (qAt >= 0) {
    q = q || p.slice(qAt + 1);
    p = p.slice(0, qAt);
  }
  const hashAt = p.indexOf("#");
  if (hashAt >= 0) p = p.slice(0, hashAt);
  if (!p.startsWith("/")) p = `/${p}`;
  const segments = p
    .split("/")
    .filter(Boolean)
    .slice(0, 6)
    .map((s) => {
      if (UUID_RE.test(s) || /^\d+$/.test(s) || (LONG_ID_RE.test(s) && /\d/.test(s))) return ":id";
      // Anything that is not a plain route word (an email, a name with a
      // space, an encoded search) is not a screen; keep the shape only.
      return /^[a-z0-9][a-z0-9-]{0,40}$/i.test(s) ? s.toLowerCase() : ":value";
    });
  let screen = `/${segments.join("/")}`;
  const pane = new URLSearchParams(q.startsWith("?") ? q.slice(1) : q).get("pane");
  if (pane && /^[a-z-]{1,20}$/.test(pane)) screen += `?pane=${pane}`;
  return screen.slice(0, 120);
}

/**
 * Take out what looks like a customer's contact or card details, in case the
 * hint was not read. Deliberately blunt: a false positive costs a word in a
 * bug report, a miss puts personal data in an admin inbox.
 */
export function scrubProblemNote(note: string): string {
  return note
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[removed]")
    // Card numbers: 13–19 digits, allowing spaces or dashes between groups.
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, "[removed]")
    // UK phone numbers: +44 or 0, then 9–10 more digits with optional spaces.
    .replace(/(?:\+44\s?|\b0)(?:\d[\s-]?){9,10}\b/g, "[removed]")
    // Postcodes (e.g. "SW1A 1AA", "M1 1AE").
    .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, "[removed]")
    .slice(0, PROBLEM_NOTE_MAX);
}

const queueSchema = z
  .object({
    waiting: z.number().int().min(0).max(100_000).default(0),
    failed: z.number().int().min(0).max(100_000).default(0),
    needsAttention: z.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export type ProblemQueueCounts = z.infer<typeof queueSchema>;

/** What the till sends. Anything not listed is refused (strict). */
export const problemReportInputSchema = z
  .object({
    /** The till's own id for this report, so a queued report sent twice is stored once. */
    clientRef: z.string().regex(/^[0-9A-Za-z_-]{8,64}$/),
    chip: z.enum(PROBLEM_CHIP_KEYS),
    note: z.string().max(PROBLEM_NOTE_MAX * 2).optional().nullable(),
    screen: z.string().max(2000),
    device: z.string().max(40).optional().nullable(),
    appVersion: z.string().max(40).optional().nullable(),
    online: z.boolean(),
    queue: queueSchema,
    /** When the person pressed Send on the till (a queued report arrives later). */
    reportedAt: z.string().datetime().optional().nullable(),
  })
  .strict();

export type ProblemReportInput = z.infer<typeof problemReportInputSchema>;

/** Version strings as the app writes them ("1.2.0", "1.2.0-rc1"). */
export const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;

export const problemResolveSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("fixed"), version: z.string().trim().regex(VERSION_RE) }).strict(),
  z.object({ outcome: z.literal("closed") }).strict(),
  z.object({ outcome: z.literal("open") }).strict(),
]);

export type ProblemResolveInput = z.infer<typeof problemResolveSchema>;

export const PROBLEM_STATUSES = ["open", "fixed", "closed"] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

/** The thanks the reporter gets in their Signals bell. */
export function fixedThanks(version: string): string {
  return `Thanks, fixed in version ${version}`;
}

/** Normalised, safe-to-store fields from a validated input. */
export function normaliseProblemReport(input: ProblemReportInput): {
  chip: ProblemChip;
  note: string | null;
  screen: string;
  device: string;
  appVersion: string | null;
  online: boolean;
  queue: ProblemQueueCounts;
} {
  const note = input.note ? scrubProblemNote(input.note.trim()) : "";
  const version = input.appVersion?.trim() ?? "";
  return {
    chip: input.chip,
    note: note ? note : null,
    screen: screenFor(input.screen),
    // Anything off the list (an old build, a hand-made request) is stored as
    // unnamed rather than trusted.
    device: isDeviceName(input.device) ? input.device : UNNAMED_DEVICE,
    appVersion: VERSION_RE.test(version) ? version : null,
    online: input.online,
    queue: input.queue,
  };
}

/**
 * Sentry tags for a report. Role, screen and device are the three tags the
 * owner asked every event to carry; nothing here identifies a person, and the
 * free text is not sent at all.
 */
export function problemSentryTags(r: {
  role: string;
  screen: string;
  device: string;
  chip: string;
  appVersion: string | null;
  online: boolean;
  id?: string;
}): Record<string, string> {
  const tags: Record<string, string> = {
    role: r.role,
    screen: r.screen,
    device: r.device,
    problem: r.chip,
    online: r.online ? "yes" : "no",
  };
  if (r.appVersion) tags.app_version = r.appVersion;
  if (r.id) tags.problem_id = r.id;
  return tags;
}
