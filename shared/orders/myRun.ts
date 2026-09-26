/**
 * My run (v1.2): the driver's phone view of their own deliveries — the pure
 * half, shared by the server (which enforces it) and the page (which shows
 * it). No database, no clock of its own.
 */
import { z } from "zod";

/** Why a delivery did not happen. "Other" needs a note: a bare "other" tells the next driver nothing. */
export const COULDNT_DELIVER_REASONS = [
  { key: "no_answer", label: "No answer" },
  { key: "wrong_address", label: "Wrong address" },
  { key: "refused", label: "Refused" },
  { key: "other", label: "Other" },
] as const;

export type CouldntDeliverReason = (typeof COULDNT_DELIVER_REASONS)[number]["key"];

export const COULDNT_DELIVER_NOTE_MAX = 300;

const REASON_KEYS = COULDNT_DELIVER_REASONS.map((r) => r.key) as [CouldntDeliverReason, ...CouldntDeliverReason[]];

export const couldntDeliverSchema = z
  .object({
    reason: z.enum(REASON_KEYS),
    note: z.string().trim().max(COULDNT_DELIVER_NOTE_MAX).optional().default(""),
    /** When the driver tapped it, if the tap was queued offline and is only arriving now. */
    tappedAt: z.string().datetime().optional(),
  })
  .refine((v) => v.reason !== "other" || v.note.length > 0, {
    message: "Say what happened.",
    path: ["note"],
  });

export type CouldntDeliverInput = z.infer<typeof couldntDeliverSchema>;

export function reasonLabel(reason: string): string {
  return COULDNT_DELIVER_REASONS.find((r) => r.key === reason)?.label ?? "Other";
}

/** The note the board card shows. The time is stored beside it (delivery_issue_at), not in it. */
export function deliveryIssueNote(reason: string, note?: string | null): string {
  const trimmed = (note ?? "").trim();
  const text = trimmed ? `Couldn't deliver: ${reasonLabel(reason)} — ${trimmed}` : `Couldn't deliver: ${reasonLabel(reason)}`;
  return text.slice(0, 600);
}

// ---------------------------------------------------------------------------
// Stop order.
// ---------------------------------------------------------------------------

/** The most stops one saved order may hold — far more than one run, small enough to bound the row. */
export const RUN_ORDER_MAX = 200;

export type OrderableStop = {
  id: string;
  /** ISO. The promise if one was given, else the lead-time estimate; null sorts last. */
  dueAt: string | null;
  createdAt: string | null;
};

function time(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const t = Date.parse(value);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * The run in the driver's order: stops they placed (in the order they placed
 * them) first, then every other stop by due time, oldest order first on a tie.
 * A saved id that is no longer on the run is ignored, so a list saved this
 * morning cannot bring back a delivery that was since done or reassigned.
 */
export function orderRunStops<T extends OrderableStop>(stops: readonly T[], savedIds: readonly string[] | null | undefined): T[] {
  const byDue = [...stops].sort(
    (a, b) => time(a.dueAt) - time(b.dueAt) || time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id),
  );
  if (!savedIds || savedIds.length === 0) return byDue;
  const byId = new Map(stops.map((s) => [s.id, s]));
  const placed: T[] = [];
  const seen = new Set<string>();
  for (const id of savedIds) {
    const stop = byId.get(id);
    if (stop && !seen.has(id)) {
      placed.push(stop);
      seen.add(id);
    }
  }
  return [...placed, ...byDue.filter((s) => !seen.has(s.id))];
}

/** One step up (-1) or down (+1). Out of range is a no-op, never a wrap. */
export function moveStop(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  return reorderIds(ids, from, from + delta);
}

/** Drag and drop: the item at `from` lands at `to`. */
export function reorderIds(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The body of PUT /api/my-run/order: order ids, no repeats, bounded. */
export const runOrderSchema = z.object({
  orderIds: z
    .array(z.string().regex(UUID_RE, "expected an order id"))
    .max(RUN_ORDER_MAX)
    .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]),
});

// ---------------------------------------------------------------------------
// Navigate: plain map links, no API keys.
// ---------------------------------------------------------------------------

export type MapsPlatform = "apple" | "google";

/** iPhone, iPod and iPad — including an iPad that says it is a Mac. */
export function mapsPlatformFor(userAgent: string, maxTouchPoints = 0): MapsPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "apple";
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "apple";
  return "google";
}

/** A directions link to the stop, or null when there is nothing to go to. */
export function mapsUrl(
  stop: { deliveryAddress: string | null | undefined; deliveryPostcode: string | null | undefined },
  platform: MapsPlatform,
): string | null {
  const destination = [stop.deliveryAddress, stop.deliveryPostcode]
    .map((part) => (part ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ");
  if (!destination) return null;
  const q = encodeURIComponent(destination);
  return platform === "apple"
    ? `https://maps.apple.com/?daddr=${q}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
}

// ---------------------------------------------------------------------------
// The stop, as the server sends it.
// ---------------------------------------------------------------------------

export type RunStop = {
  id: string;
  shortCode: string;
  customerName: string | null;
  /** Whether there is a customer to call — never the number itself. */
  hasCustomer: boolean;
  deliveryAddress: string | null;
  deliveryPostcode: string | null;
  deliveryNotes: string | null;
  deliveryIssue: string | null;
  deliveryIssueAt: string | null;
  itemCount: number;
  total: string;
  /** The part of the order on tick (credit): still owed by the customer. 0 when fully paid. */
  onTick: number;
  dueAt: string | null;
  createdAt: string | null;
  readyAt: string | null;
  outForDeliveryAt: string | null;
  status: string;
  assignedUserId: string | null;
};

export type RunPayload = {
  /** The trading day the saved order belongs to (YYYY-MM-DD). */
  day: string;
  /** The org's timezone, for showing due times. */
  timezone: string;
  driver: { userId: string; name: string };
  /** True when a manager is looking at someone else's run: read-only. */
  viewingOther: boolean;
  stops: RunStop[];
  /** Managers and above: people with live deliveries, to pick whose run to view. */
  drivers?: Array<{ userId: string; name: string }>;
};

/** Where a stop is: waiting to go, or on the road. */
export function stopStage(stop: Pick<RunStop, "outForDeliveryAt">): "ready" | "out" {
  return stop.outForDeliveryAt ? "out" : "ready";
}
