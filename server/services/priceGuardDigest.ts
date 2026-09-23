/**
 * Twice-daily round-up of below-minimum Signals (v1.2 Phase 4, PRC-04).
 *
 * When an admin chooses "twice daily", a below-minimum order is recorded as
 * usual but its Signal is held (price_guard_orders.signal_pending). At each
 * round-up (12:00 and 18:00 in the org's zone) the held orders are claimed and
 * sent as ONE Signal per person who rang them — per person, so it still
 * reaches only people who outrank them. Below cost is never held.
 *
 * Exactly once: the rows are claimed with FOR UPDATE SKIP LOCKED and cleared
 * in the same transaction that writes the Signal.
 */
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { db } from "../db";
import { priceGuardOrders } from "@shared/schema";
import { latestDigestSlot } from "@shared/review/exceptions";
import { orderRefOf, PRICE_GUARD_REASON_LABELS, isPriceGuardReason } from "@shared/pricing/priceGuard";
import { notify } from "./signals";
import { priceGuardEnabled } from "./priceGuard";
import { resolveUserNames } from "./userDisplayName";
import { orgTimeZone } from "./tradingDayShift";

type Executor = typeof db | any;
type GuardRow = typeof priceGuardOrders.$inferSelect;

function describe(row: GuardRow): string {
  const why = row.confirmed === false ? "unconfirmed" : isPriceGuardReason(row.reason) ? PRICE_GUARD_REASON_LABELS[row.reason] : "no reason";
  return `${orderRefOf(row.orderId)} £${Number(row.underMinimum).toFixed(2)} (${why})`;
}

export function digestMessage(who: string, rows: GuardRow[]): string {
  const under = rows.reduce((s, r) => s + Number(r.underMinimum || 0), 0);
  const n = rows.length;
  const listed = rows.slice(0, 10).map(describe).join("; ");
  const more = n > 10 ? `; and ${n - 10} more` : "";
  return `£${under.toFixed(2)} under minimum on ${n} order${n === 1 ? "" : "s"} by ${who}: ${listed}${more}.`;
}

/** Sends every round-up that is due. Returns how many Signals went out. */
export async function runDuePriceGuardDigests(now: Date = new Date()): Promise<number> {
  const orgs: Array<{ orgId: string }> = await db
    .selectDistinct({ orgId: priceGuardOrders.orgId })
    .from(priceGuardOrders)
    .where(eq(priceGuardOrders.signalPending, true));
  let sent = 0;
  for (const { orgId } of orgs) {
    const slot = latestDigestSlot(now, await orgTimeZone(orgId));
    sent += await sendDigestForOrg(orgId, slot);
  }
  return sent;
}

export async function sendDigestForOrg(orgId: string, slot: Date): Promise<number> {
  return db.transaction(async (tx: Executor) => {
    const due: GuardRow[] = await tx
      .select()
      .from(priceGuardOrders)
      .where(
        and(eq(priceGuardOrders.orgId, orgId), eq(priceGuardOrders.signalPending, true), lte(priceGuardOrders.createdAt, slot)),
      )
      .orderBy(asc(priceGuardOrders.createdAt))
      .for("update", { skipLocked: true });
    if (due.length === 0) return 0;
    await tx
      .update(priceGuardOrders)
      .set({ signalPending: false })
      .where(inArray(priceGuardOrders.id, due.map((r) => r.id)));
    // The switch was turned off after these were held: Signals have stopped,
    // so the round-up is dropped. The rows stay in Needs a look and Evidence.
    if (!(await priceGuardEnabled(orgId, tx))) return 0;

    const byPerson = new Map<string, GuardRow[]>();
    for (const r of due) {
      const key = r.userId ?? "";
      byPerson.set(key, [...(byPerson.get(key) ?? []), r]);
    }
    const names = await resolveUserNames([...byPerson.keys()].filter(Boolean));
    let out = 0;
    for (const [userId, rows] of byPerson) {
      const who = userId ? names.get(userId) ?? "Unknown" : "Unknown";
      const unconfirmed = rows.some((r) => r.confirmed === false);
      const signal = await notify(
        {
          orgId,
          title: `Below minimum round-up — ${who}`,
          message: digestMessage(who, rows),
          severity: unconfirmed ? "error" : "warning",
          source: "price_guard_digest",
          subjectUserId: userId || null,
          metadata: { orderIds: rows.map((r) => r.orderId), entityIds: rows.map((r) => r.id) },
        },
        tx,
      );
      await tx
        .update(priceGuardOrders)
        .set({ signalId: signal.id })
        .where(inArray(priceGuardOrders.id, rows.map((r) => r.id)));
      out++;
    }
    return out;
  });
}
