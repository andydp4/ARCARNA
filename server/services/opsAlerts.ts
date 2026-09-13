/**
 * Personal Operations Centre alerts — generation, resolution and the sweep
 * (Phase N, N5a; docs/briefs/PHASE_N_OPERATIONS_CENTRE.md, "Alerts &
 * notifications").
 *
 * Two ways an `ops_alerts` row comes to exist:
 *  - TRANSACTIONAL kinds (`assigned`, `customer_waiting`, `delayed`) via
 *    `createInTx` and its per-kind wrappers, called from inside the SAME
 *    `SELECT … FOR UPDATE` transaction that made the fact true
 *    (`server/services/orderTransitions.ts`, `server/routes/reportCapture.ts`).
 *  - TIME-BASED kinds (`due_soon`, `late`, `new_unassigned`) via
 *    `sweepOpsAlerts(now)`, run on every active worker tick
 *    (`server/workers/index.ts`) rather than by any one request — nobody taps
 *    a button to make a promise fall due.
 *
 * Idempotent by ONE mechanism only: `ops_alerts_once_idx`
 * (`org_id, order_id, kind, user_id, due_key`, migration 066). Every insert
 * below goes through `createInTx`, which always inserts with
 * `ON CONFLICT DO NOTHING` against that exact index — never a
 * check-then-insert, which would race against a concurrent sweep or a second
 * request the same way the pre-N3b completion race did (brief, finding G4).
 * A server restart mid-sweep re-evaluates every order from scratch and simply
 * finds its own already-written rows in conflict; nothing is lost or
 * doubled.
 *
 * Resolution is the mirror image: `resolveOpsAlertsForTransition`, called
 * from inside the SAME transaction as the stamp that makes an alert stale, so
 * a card can never show an open alert for something that already happened —
 * the same "one lock, one truth" discipline `orderTransitions.ts` already
 * applies to the stamp and its `order_events` row.
 */
import {
  customerWaitingRecipients,
  delayedRecipients,
  dueKeyFor,
  dueSoonOrLateRecipients,
  newUnassignedRecipients,
  shouldAlertAssigned,
  shouldAlertDueSoon,
  shouldAlertNewUnassigned,
  type OpsAlertKind,
  type OpsStaffPresence,
} from "@shared/orders/opsAlerts";
// `opsBus.ts` only imports `type BoardOrderPayload` from `./opsBoard` (a
// type-only import, erased at build time — see its own header) and nothing
// from this module, so a static import here creates no runtime cycle with
// `opsBoard.ts` (which DOES import `listFor` from this file). Static, not the
// dynamic `await import(...)` this file uses for `../db` and `@shared/schema`
// elsewhere: those are lazy purely to avoid pulling in a live DB pool for
// callers (tests) that only want the pure recipient helpers, a concern that
// does not apply to `opsBus.ts`.
import { publishOpsEvent } from "./opsBus";

/** Presence window — same 15 minutes the board and the default-owner rule use. */
const PRESENT_WITHIN_MINUTES = 15;

// --------------------------------------------------------------------------
// Generation — transactional kinds
// --------------------------------------------------------------------------

/** One row `createInTx` is about to insert. */
export interface OpsAlertRow {
  orgId: string;
  orderId: string;
  userId: string;
  station: "" | "collection" | "delivery" | "both";
  kind: OpsAlertKind;
  dueKey: string;
  dueAt: Date | null;
}

/**
 * One row `createInTx` (its per-kind wrappers, and `sweepOpsAlerts`'s own
 * direct insert) actually inserted (post `ON CONFLICT DO NOTHING`) — enough
 * to build the `{ type: 'alert' }` `opsBus` event `publishAlertRows` sends:
 * `orgId` to route it to the right org's stream, everything else identical to
 * `OpsAlertListItem` (the shape a poll of `GET /api/orders/board` would have
 * returned for this same row) plus `userId`, which a poll's response never
 * carries (it is implicitly "whoever asked") but a per-org broadcast MUST, so
 * every connected tablet can filter down to only the alert rows addressed to
 * ITS signed-in user (see `client/src/hooks/useOpsBoard.ts`'s `applyOpsBusEvent`).
 */
export interface OpsAlertCreatedRow extends OpsAlertListItem {
  orgId: string;
  userId: string;
}

/**
 * The one insert path every alert — transactional or swept — goes through.
 * `ON CONFLICT DO NOTHING` against `ops_alerts_once_idx` is the whole
 * idempotency contract (module doc); no caller may bypass it with a plain
 * `.insert()`.
 */
export async function createInTx(tx: any, rows: OpsAlertRow[]): Promise<OpsAlertCreatedRow[]> {
  if (rows.length === 0) return [];
  const { opsAlerts } = await import("@shared/schema");
  const inserted = await tx
    .insert(opsAlerts)
    .values(
      rows.map((r) => ({
        orgId: r.orgId,
        orderId: r.orderId,
        userId: r.userId,
        station: r.station,
        kind: r.kind,
        dueKey: r.dueKey,
        dueAt: r.dueAt,
      })),
    )
    .onConflictDoNothing({
      target: [opsAlerts.orgId, opsAlerts.orderId, opsAlerts.kind, opsAlerts.userId, opsAlerts.dueKey],
    })
    .returning({
      id: opsAlerts.id,
      orgId: opsAlerts.orgId,
      orderId: opsAlerts.orderId,
      userId: opsAlerts.userId,
      station: opsAlerts.station,
      kind: opsAlerts.kind,
      dueAt: opsAlerts.dueAt,
      createdAt: opsAlerts.createdAt,
    });
  return inserted.map(toCreatedRow);
}

/** Shared by every insert path (`createInTx`, `sweepOpsAlerts`) so the pushed shape can never drift between them. */
function toCreatedRow(r: {
  id: string;
  orgId: string;
  orderId: string;
  userId: string;
  station: string;
  kind: string;
  dueAt: Date | null;
  createdAt: Date;
}): OpsAlertCreatedRow {
  return {
    id: r.id,
    orgId: r.orgId,
    orderId: r.orderId,
    userId: r.userId,
    kind: r.kind as OpsAlertKind,
    station: r.station as OpsAlertListItem["station"],
    dueAt: r.dueAt ? r.dueAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Publishes one `{ type: 'alert' }` opsBus event per newly-inserted row.
 * Callers MUST call this only AFTER the transaction that inserted the rows
 * has committed — never from inside it, where a later rollback would make the
 * push a lie (the exact discipline `orderTransitions.ts` already applies to
 * its own `{ type: 'order' }` push). Best-effort: one row's publish failure is
 * logged and skipped, never thrown — a push failure must not be able to
 * unwind or fail work that has already durably committed.
 */
export function publishAlertRows(rows: OpsAlertCreatedRow[]): void {
  for (const row of rows) {
    try {
      const { orgId, ...alert } = row;
      publishOpsEvent(orgId, { type: "alert", alert });
    } catch (pushError) {
      console.error("[OpsAlerts] Failed to push a new alert to the board stream:", pushError);
    }
  }
}

/** `ops_staff` for one org, in the shape the pure recipient functions need — read inside the caller's own transaction. */
export async function loadStaffPresenceInTx(tx: any, orgId: string, now: Date): Promise<OpsStaffPresence[]> {
  const { opsStaff } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await tx.select().from(opsStaff).where(eq(opsStaff.orgId, orgId));
  const cutoff = now.getTime() - PRESENT_WITHIN_MINUTES * 60_000;
  return rows.map((r: { userId: string; station: string | null; onBreak: boolean; lastSeenAt: Date | null }) => ({
    userId: r.userId,
    station: (r.station as OpsStaffPresence["station"]) ?? null,
    onBreak: r.onBreak,
    present: r.lastSeenAt != null && r.lastSeenAt.getTime() >= cutoff,
  }));
}

/**
 * `assigned` — brief: "the new assignee (not on self-claim, and not the
 * inputter when the default-owner rule picks them) | in the assign / create
 * transaction | yes". Called from `orderTransitions.ts`'s `claim` and
 * `assign` cases; `shouldAlertAssigned` decides whether to write anything at
 * all.
 */
export async function alertAssignedInTx(
  tx: any,
  params: {
    orgId: string;
    orderId: string;
    assigneeId: string;
    actorId: string | null;
    isDefaultOwnerPick?: boolean;
    inputUserId?: string | null;
    assignedAt: Date;
  },
): Promise<OpsAlertCreatedRow[]> {
  if (
    !shouldAlertAssigned({
      assigneeId: params.assigneeId,
      actorId: params.actorId,
      isDefaultOwnerPick: params.isDefaultOwnerPick ?? false,
      inputUserId: params.inputUserId ?? null,
    })
  ) {
    return [];
  }
  return createInTx(tx, [
    {
      orgId: params.orgId,
      orderId: params.orderId,
      userId: params.assigneeId,
      station: "",
      kind: "assigned",
      // The assignment's own instant, not '': a person unassigned and later
      // reassigned to the SAME order must be told again, and a fixed '' key
      // would collide with their first `assigned` row forever (migration
      // 066's unique index has no notion of "already resolved").
      dueKey: dueKeyFor(params.assignedAt),
      dueAt: null,
    },
  ]);
}

/** `customer_waiting` — brief: "assignee, else present Collection members | on `arrived` when not ready | yes". */
export async function alertCustomerWaitingInTx(
  tx: any,
  params: { orgId: string; orderId: string; assigneeId: string | null; staff: OpsStaffPresence[]; arrivedAt: Date },
): Promise<OpsAlertCreatedRow[]> {
  const recipients = customerWaitingRecipients(params.assigneeId, params.staff);
  return createInTx(
    tx,
    recipients.map((r) => ({
      orgId: params.orgId,
      orderId: params.orderId,
      userId: r.userId,
      station: r.station,
      kind: "customer_waiting" as const,
      dueKey: dueKeyFor(params.arrivedAt),
      dueAt: params.arrivedAt,
    })),
  );
}

/** `delayed` — brief: "assignee, when someone else declared it | in the `/operations` transaction | no". */
export async function alertDelayedInTx(
  tx: any,
  params: { orgId: string; orderId: string; assigneeId: string | null; actorId: string | null; revisedEta: Date | null; declaredAt: Date },
): Promise<OpsAlertCreatedRow[]> {
  const recipients = delayedRecipients(params.assigneeId, params.actorId);
  // A delay declared with no explicit revised time still needs a fresh cycle
  // per declaration, or a second delay minutes later would collide on the
  // same '' due_key as the first and never alert. `revisedEta`, when given,
  // is the more meaningful key (it IS the new promise).
  const dueKey = dueKeyFor(params.revisedEta ?? params.declaredAt);
  return createInTx(
    tx,
    recipients.map((r) => ({
      orgId: params.orgId,
      orderId: params.orderId,
      userId: r.userId,
      station: r.station,
      kind: "delayed" as const,
      dueKey,
      dueAt: params.revisedEta,
    })),
  );
}

// --------------------------------------------------------------------------
// Reading — the board's `alerts` field
// --------------------------------------------------------------------------

/** One row of `GET /api/orders/board`'s `alerts` array. */
export interface OpsAlertListItem {
  id: string;
  orderId: string;
  kind: OpsAlertKind;
  station: "" | "collection" | "delivery" | "both";
  dueAt: string | null;
  createdAt: string;
}

/**
 * Brief: "`listFor` returns only unacked, unresolved rows whose order is in
 * the board payload" — the last clause matters as much as the first two: a
 * row for an order the caller cannot currently see (already rolled out of
 * the board's own 120-minute "Done today" window, say) must not surface
 * either, or the rail could point at a card that is not on the screen.
 */
export async function listFor(orgId: string, userId: string | null, orderIds: string[]): Promise<OpsAlertListItem[]> {
  if (!userId || orderIds.length === 0) return [];
  const { db } = await import("../db");
  const { opsAlerts } = await import("@shared/schema");
  const { and, eq, inArray, isNull } = await import("drizzle-orm");
  const rows = await db
    .select({
      id: opsAlerts.id,
      orderId: opsAlerts.orderId,
      kind: opsAlerts.kind,
      station: opsAlerts.station,
      dueAt: opsAlerts.dueAt,
      createdAt: opsAlerts.createdAt,
    })
    .from(opsAlerts)
    .where(
      and(
        eq(opsAlerts.orgId, orgId),
        eq(opsAlerts.userId, userId),
        isNull(opsAlerts.ackedAt),
        isNull(opsAlerts.resolvedAt),
        inArray(opsAlerts.orderId, orderIds),
      ),
    )
    .orderBy(opsAlerts.createdAt);
  return rows.map((r: { id: string; orderId: string; kind: string; station: string; dueAt: Date | null; createdAt: Date }) => ({
    id: r.id,
    orderId: r.orderId,
    kind: r.kind as OpsAlertKind,
    station: r.station as OpsAlertListItem["station"],
    dueAt: r.dueAt ? r.dueAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

// --------------------------------------------------------------------------
// Resolution — brief: "Resolution in the same transaction"
// --------------------------------------------------------------------------

export type OpsAlertResolutionAction = "claim" | "assign" | "ready" | "hold" | "complete" | "delete";

/**
 * Brief, "Alerts & notifications": "claim / assign resolves `new_unassigned`,
 * `due_soon`, `late` for everyone but the new assignee; `ready` resolves
 * `customer_waiting` and, on collection, `due_soon` / `late`; `hold` resolves
 * `due_soon`; `complete` / `delete` resolve all."
 *
 * Called from inside the SAME `SELECT … FOR UPDATE` transaction as the stamp
 * that makes the alert stale (`server/services/orderTransitions.ts`) — never
 * as a separate, later write, which would leave a window where the board
 * shows both the fresh card state AND a now-wrong alert.
 *
 * `delete` is accepted here for API completeness (the brief's own resolution
 * table names it) but has no caller in this package: `DELETE /api/orders/:id`
 * lives in `server/routes/orders.ts`, outside N5a's touch list. A deleted
 * order's alerts are still resolved — `sweepOpsAlerts`'s orphan cleanup below
 * finds them the next active tick, the same safety net that also catches a
 * completion made through the legacy `PATCH /api/orders/:id` path rather than
 * through this transition set.
 */
export async function resolveOpsAlertsForTransition(
  tx: any,
  params: {
    orgId: string;
    orderId: string;
    action: OpsAlertResolutionAction;
    /** `claim` / `assign`: the new assignee, excluded from the rows being resolved. */
    newAssigneeId?: string | null;
    /** `ready`: whether `due_soon`/`late` also resolve (collection only). */
    fulfilmentMethod?: "collection" | "delivery";
    resolvedByUserId: string | null;
  },
): Promise<void> {
  const { opsAlerts } = await import("@shared/schema");
  const { and, eq, inArray, isNull, ne } = await import("drizzle-orm");
  const now = new Date();
  const open = and(eq(opsAlerts.orgId, params.orgId), eq(opsAlerts.orderId, params.orderId), isNull(opsAlerts.resolvedAt));

  const resolve = async (where: unknown, reason: string) => {
    await tx
      .update(opsAlerts)
      .set({ resolvedAt: now, resolvedByUserId: params.resolvedByUserId, resolvedReason: reason })
      .where(where);
  };

  switch (params.action) {
    case "claim":
    case "assign": {
      const kindMatch = inArray(opsAlerts.kind, ["new_unassigned", "due_soon", "late"]);
      const conditions = [open, kindMatch];
      if (params.newAssigneeId) conditions.push(ne(opsAlerts.userId, params.newAssigneeId));
      await resolve(and(...conditions), params.action === "claim" ? "claimed" : "reassigned");
      return;
    }
    case "ready": {
      await resolve(and(open, eq(opsAlerts.kind, "customer_waiting")), "ready");
      if (params.fulfilmentMethod === "collection") {
        await resolve(and(open, inArray(opsAlerts.kind, ["due_soon", "late"])), "ready");
      }
      return;
    }
    case "hold": {
      await resolve(and(open, eq(opsAlerts.kind, "due_soon")), "held");
      return;
    }
    case "complete":
    case "delete": {
      await resolve(open, params.action === "complete" ? "completed" : "deleted");
      return;
    }
    default: {
      const exhaustive: never = params.action;
      throw new Error(`Unknown ops-alert resolution action: ${String(exhaustive)}`);
    }
  }
}

// --------------------------------------------------------------------------
// Time-based generation + the sweep-wide safety net — server/workers/index.ts
// --------------------------------------------------------------------------

interface SweepOrgSettings {
  id: string;
  timezone: string;
  dueSoonLeadMinutes: number;
  lateGraceMinutes: number;
  prepSlaMinutes: number;
  deliveryLeadMinutes: number;
  alertOnSlaDue: boolean;
}

interface SweepOrderRow {
  id: string;
  orgId: string;
  fulfilmentMethod: string | null;
  dateKind: string | null;
  createdAt: Date | null;
  enteredAt: Date | null;
  etaGiven: Date | null;
  revisedEta: Date | null;
  readyAt: Date | null;
  assignedUserId: string | null;
  inputUserId: string | null;
}

export interface OpsAlertSweepResult {
  /** Rows actually inserted (post ON CONFLICT DO NOTHING) — not attempts. */
  created: number;
  /** Rows resolved because their order rolled over, was deleted, or is completed (defensive net). */
  resolved: number;
}

/**
 * Everything `sweepOpsAlerts` needs about staff presence for one org, built
 * once per sweep rather than once per order.
 */
function presenceIndex(
  staffRows: Array<{ orgId: string; userId: string; station: string | null; onBreak: boolean; lastSeenAt: Date | null }>,
  now: Date,
): Map<string, OpsStaffPresence[]> {
  const cutoff = now.getTime() - PRESENT_WITHIN_MINUTES * 60_000;
  const byOrg = new Map<string, OpsStaffPresence[]>();
  for (const row of staffRows) {
    const list = byOrg.get(row.orgId) ?? [];
    list.push({
      userId: row.userId,
      station: (row.station as OpsStaffPresence["station"]) ?? null,
      onBreak: row.onBreak,
      present: row.lastSeenAt != null && row.lastSeenAt.getTime() >= cutoff,
    });
    byOrg.set(row.orgId, list);
  }
  return byOrg;
}

/**
 * Time-based kinds (`due_soon`, `late`, `new_unassigned`) plus the sweep's
 * own resolution duty for rows whose order has since been completed, deleted
 * or carried over (brief: "The sweep resolves rows whose order is completed,
 * deleted or carried over").
 *
 * Deliberately global (every org in one pass) rather than per-org: the
 * worker runner has no org context, and a shop's whole open-order count is
 * small enough that scanning it once per active tick costs about what
 * `getOpsBoard` already costs for one org (N3a's own <150ms DoD).
 *
 * `now` is always injected (`docs/testing/FAKE_TIME.md` §1) — this function
 * never reads the clock itself, so `opsAlertSweep.test.ts` can seed a
 * promise a fixed distance from an arbitrary `now` rather than waiting on
 * real minutes to pass.
 */
export async function sweepOpsAlerts(now: Date = new Date()): Promise<OpsAlertSweepResult> {
  const { db } = await import("../db");
  const { orders, organizations, opsStaff, opsAlerts } = await import("@shared/schema");
  const { and, eq, inArray, isNull, ne, sql } = await import("drizzle-orm");
  const { currentTradingDay } = await import("@shared/time/tradingDay");

  // `currentTradingDay` builds a fresh `Intl.DateTimeFormat` on every call
  // (shared/time/tradingDay.ts has no formatter cache of its own — unlike
  // shared/orders/opsState.ts's, whose own doc comment measured that
  // construction cost at "over 300ms" for ~2,000 calls). This sweep calls it
  // once per OPEN ORDER on every active tick; "today" itself only depends on
  // (timezone, now), both fixed for the whole sweep, so memoising it here —
  // rather than in the shared module, which is out of this package's touch
  // list and used well beyond this one caller — turns what would be one
  // redundant construction per order into one per distinct timezone.
  const todayCache = new Map<string, string>();
  const todayFor = (timezone: string): string => {
    let day = todayCache.get(timezone);
    if (!day) {
      day = currentTradingDay(timezone, now);
      todayCache.set(timezone, day);
    }
    return day;
  };

  const openOrders = (await db
    .select({
      id: orders.id,
      orgId: orders.orgId,
      fulfilmentMethod: orders.fulfilmentMethod,
      dateKind: orders.dateKind,
      createdAt: orders.createdAt,
      enteredAt: orders.enteredAt,
      etaGiven: orders.etaGiven,
      revisedEta: orders.revisedEta,
      readyAt: orders.readyAt,
      assignedUserId: orders.assignedUserId,
      inputUserId: orders.inputUserId,
    })
    .from(orders)
    .where(ne(orders.status, "completed"))) as SweepOrderRow[];

  let resolved = 0;

  if (openOrders.length === 0) {
    resolved += await resolveOrphanedAndCompleted(db, opsAlerts, orders);
    return { created: 0, resolved };
  }

  const orgIds = Array.from(new Set(openOrders.map((o) => o.orgId)));
  const orgRowsRaw = await db
    .select({
      id: organizations.id,
      timezone: organizations.timezone,
      dueSoonLeadMinutes: organizations.opsDueSoonLeadMinutes,
      lateGraceMinutes: organizations.opsLateGraceMinutes,
      prepSlaMinutes: organizations.opsPrepSlaMinutes,
      deliveryLeadMinutes: organizations.opsDeliveryLeadMinutes,
      alertOnSlaDue: organizations.opsAlertOnSlaDue,
    })
    .from(organizations)
    .where(inArray(organizations.id, orgIds));
  const orgById = new Map<string, SweepOrgSettings>(
    orgRowsRaw.map((o) => [
      o.id,
      { ...o, timezone: o.timezone || "Europe/London" },
    ]),
  );

  const staffRows = await db
    .select()
    .from(opsStaff)
    .where(inArray(opsStaff.orgId, orgIds));
  const presenceByOrg = presenceIndex(staffRows, now);

  const rows: OpsAlertRow[] = [];
  const carriedOverOrderIds: string[] = [];

  for (const order of openOrders) {
    const org = orgById.get(order.orgId);
    if (!org) continue; // org settings missing is a data problem elsewhere, not this sweep's to fix
    const fulfilmentMethod: "collection" | "delivery" = order.fulfilmentMethod === "delivery" ? "delivery" : "collection";
    const receivedAt = order.enteredAt ?? order.createdAt ?? now;
    const today = todayFor(org.timezone);
    const staff = presenceByOrg.get(order.orgId) ?? [];

    // Backdated: never alerts, ever (brief, card-state table row 6: "never
    // goes late"; the same exemption applies to every time-based alert).
    if (order.dateKind === "backdated") continue;

    if (order.dateKind === "preorder") {
      const dueForDayCheck = order.revisedEta ?? order.etaGiven ?? receivedAt;
      const promiseDay = currentTradingDay(org.timezone, dueForDayCheck);
      if (promiseDay > today) continue; // still in the Scheduled strip — "no clocks, no alerts"
    } else if (order.dateKind === "live") {
      const receivedDay = currentTradingDay(org.timezone, receivedAt);
      if (receivedDay < today) {
        carriedOverOrderIds.push(order.id);
        continue; // Yesterday strip — "no clocks, no alerts, excluded from lateNow"
      }
    }

    const dueAt = order.revisedEta ?? order.etaGiven ?? null;

    if (dueAt) {
      // due_soon and late are both "promise only" (brief) — this branch only.
      const dueKey = dueKeyFor(dueAt);
      const eligibleForDueSoon = shouldAlertDueSoon({ receivedAt, dueAt, leadMinutes: org.dueSoonLeadMinutes });
      const dueSoonAt = new Date(dueAt.getTime() - org.dueSoonLeadMinutes * 60_000);
      if (eligibleForDueSoon && now.getTime() >= dueSoonAt.getTime()) {
        for (const r of dueSoonOrLateRecipients({
          kind: "due_soon",
          assigneeId: order.assignedUserId,
          assigneePresent: true, // unused for due_soon — no absence widening
          fulfilmentMethod,
          staff,
        })) {
          rows.push({ orgId: order.orgId, orderId: order.id, userId: r.userId, station: r.station, kind: "due_soon", dueKey, dueAt });
        }
      }

      const lateApplicable = fulfilmentMethod === "collection" ? !order.readyAt : true;
      const lateAt = new Date(dueAt.getTime() + org.lateGraceMinutes * 60_000);
      if (lateApplicable && now.getTime() >= lateAt.getTime()) {
        const assigneePresent = order.assignedUserId
          ? staff.some((s) => s.userId === order.assignedUserId && s.present)
          : false;
        for (const r of dueSoonOrLateRecipients({
          kind: "late",
          assigneeId: order.assignedUserId,
          assigneePresent,
          fulfilmentMethod,
          staff,
        })) {
          rows.push({ orgId: order.orgId, orderId: order.id, userId: r.userId, station: r.station, kind: "late", dueKey, dueAt });
        }
      }
    } else if (org.alertOnSlaDue) {
      // SLA-derived: `late` only — `due_soon` is "promise only" with no toggle (brief).
      const leadMinutes = fulfilmentMethod === "delivery" ? org.deliveryLeadMinutes : org.prepSlaMinutes;
      const dueEffective = new Date(receivedAt.getTime() + leadMinutes * 60_000);
      const lateApplicable = fulfilmentMethod === "collection" ? !order.readyAt : true;
      const lateAt = new Date(dueEffective.getTime() + org.lateGraceMinutes * 60_000);
      if (lateApplicable && now.getTime() >= lateAt.getTime()) {
        const assigneePresent = order.assignedUserId
          ? staff.some((s) => s.userId === order.assignedUserId && s.present)
          : false;
        const dueKey = dueKeyFor(dueEffective);
        for (const r of dueSoonOrLateRecipients({
          kind: "late",
          assigneeId: order.assignedUserId,
          assigneePresent,
          fulfilmentMethod,
          staff,
        })) {
          rows.push({ orgId: order.orgId, orderId: order.id, userId: r.userId, station: r.station, kind: "late", dueKey, dueAt: dueEffective });
        }
      }
    }

    if (!order.assignedUserId) {
      const ageSeconds = (now.getTime() - receivedAt.getTime()) / 1000;
      const loaderPresent = order.inputUserId ? staff.some((s) => s.userId === order.inputUserId && s.present) : false;
      if (shouldAlertNewUnassigned({ ageSeconds, loaderPresent })) {
        const dueKey = dueKeyFor(receivedAt);
        for (const r of newUnassignedRecipients(fulfilmentMethod, staff)) {
          rows.push({ orgId: order.orgId, orderId: order.id, userId: r.userId, station: r.station, kind: "new_unassigned", dueKey, dueAt: null });
        }
      }
    }
  }

  let created = 0;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const inserted = await db
      .insert(opsAlerts)
      .values(chunk)
      .onConflictDoNothing({
        target: [opsAlerts.orgId, opsAlerts.orderId, opsAlerts.kind, opsAlerts.userId, opsAlerts.dueKey],
      })
      .returning({
        id: opsAlerts.id,
        orgId: opsAlerts.orgId,
        orderId: opsAlerts.orderId,
        userId: opsAlerts.userId,
        station: opsAlerts.station,
        kind: opsAlerts.kind,
        dueAt: opsAlerts.dueAt,
        createdAt: opsAlerts.createdAt,
      });
    created += inserted.length;
    // This insert commits per-statement through the pooled `db` (not a `tx`)
    // — there is no later "after commit" boundary to wait for the way
    // `orderTransitions.ts` waits for `withTransaction` to return, so publish
    // each chunk's rows immediately once Postgres has confirmed them.
    // `publishAlertRows` is itself best-effort (catches per row), so a push
    // failure here can never fail the sweep.
    publishAlertRows(inserted.map(toCreatedRow));
  }

  if (carriedOverOrderIds.length > 0) {
    const result = await db
      .update(opsAlerts)
      .set({ resolvedAt: now, resolvedReason: "rolled_over" })
      .where(and(isNull(opsAlerts.resolvedAt), inArray(opsAlerts.orderId, carriedOverOrderIds)))
      .returning({ id: opsAlerts.id });
    resolved += result.length;
  }

  resolved += await resolveOrphanedAndCompleted(db, opsAlerts, orders);

  return { created, resolved };
}

/**
 * Defensive net for the two OTHER ways an order stops being "open" without
 * going through `resolveOpsAlertsForTransition`: deleted outright (no
 * matching `orders` row survives to check a status on) and completed through
 * a path other than `POST …/transition` (the legacy `PATCH /api/orders/:id`,
 * kept per the brief, calls `completeOrderTx` directly). Both are safe to
 * run unconditionally on every sweep: a row already resolved is excluded by
 * `resolved_at IS NULL`, so re-running this finds nothing the second time.
 */
async function resolveOrphanedAndCompleted(db: any, opsAlerts: any, orders: any): Promise<number> {
  const { sql } = await import("drizzle-orm");
  const now = new Date();
  const completedResult = await db.execute(sql`
    UPDATE ops_alerts a
    SET resolved_at = ${now}, resolved_reason = 'completed'
    FROM orders o
    WHERE a.order_id = o.id AND a.resolved_at IS NULL AND o.status = 'completed'
    RETURNING a.id
  `);
  const deletedResult = await db.execute(sql`
    UPDATE ops_alerts a
    SET resolved_at = ${now}, resolved_reason = 'deleted'
    WHERE a.resolved_at IS NULL AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = a.order_id)
    RETURNING a.id
  `);
  const countOf = (result: unknown): number => {
    const rows = (result as { rows?: unknown[] })?.rows ?? (Array.isArray(result) ? (result as unknown[]) : []);
    return Array.isArray(rows) ? rows.length : 0;
  };
  return countOf(completedResult) + countOf(deletedResult);
}

// --------------------------------------------------------------------------
// Precise wake — server/workers/index.ts
// --------------------------------------------------------------------------

/**
 * The earliest FUTURE instant any order's `due_soon` or `late` alert would
 * become due, across every org, or `null` when nothing open has a promise
 * (or an SLA-derived due date, for orgs that opted in).
 *
 * Brief: "`nextOpsAlertAt()` is `MIN` over `orders_revised_open_idx` and
 * `orders_eta_open_idx` (plus `orders_nodue_open_idx` joined to org SLAs only
 * for orgs with `ops_alert_on_sla_due`), excluding backdated, pre-orders
 * before their promise, and carried-over rows." Reading each of those
 * partial indexes in due-time order and stopping at a small bound (rather
 * than aggregating every open order's exact candidate in SQL, which would
 * need the 06:00 trading-day cut expressed in SQL) keeps this cheap while
 * reusing the exact same trading-day and lead/grace maths `sweepOpsAlerts`
 * and the board already use — two sources of truth for "is this due yet"
 * would be worse than the extra `ORDER BY … LIMIT` round trip.
 *
 * Deliberately returns only FUTURE instants: anything already due will have
 * been generated by the very same tick's `sweepOpsAlerts` call before this
 * ever runs (`server/workers/index.ts` calls both from the active branch),
 * so a past candidate here would just re-schedule an immediate wake forever
 * for an order whose alert already exists — the busy-loop `startWorkerRunner`'s
 * whole exponential-backoff design exists to avoid.
 */
export async function nextOpsAlertAt(now: Date = new Date()): Promise<Date | null> {
  const { db } = await import("../db");
  const { orders, organizations } = await import("@shared/schema");
  const { and, asc, eq, isNotNull, isNull, ne, or } = await import("drizzle-orm");
  const { currentTradingDay } = await import("@shared/time/tradingDay");

  // Same memoisation as sweepOpsAlerts, and the same reason: "today" depends
  // only on (timezone, now), both fixed for this whole call, so there is no
  // reason to rebuild the `Intl.DateTimeFormat` behind it once per candidate
  // row when there are at most a handful of distinct org timezones.
  const todayCache = new Map<string, string>();
  const todayFor = (timezone: string): string => {
    let day = todayCache.get(timezone);
    if (!day) {
      day = currentTradingDay(timezone, now);
      todayCache.set(timezone, day);
    }
    return day;
  };

  const CANDIDATE_LIMIT = 200;
  let earliest: number | null = null;
  const consider = (instant: Date) => {
    if (instant.getTime() <= now.getTime()) return; // already due — this tick's sweep already handled it
    if (earliest === null || instant.getTime() < earliest) earliest = instant.getTime();
  };

  const promiseRows = await db
    .select({
      dateKind: orders.dateKind,
      createdAt: orders.createdAt,
      enteredAt: orders.enteredAt,
      etaGiven: orders.etaGiven,
      revisedEta: orders.revisedEta,
      readyAt: orders.readyAt,
      fulfilmentMethod: orders.fulfilmentMethod,
      timezone: organizations.timezone,
      dueSoonLeadMinutes: organizations.opsDueSoonLeadMinutes,
      lateGraceMinutes: organizations.opsLateGraceMinutes,
    })
    .from(orders)
    .innerJoin(organizations, eq(orders.orgId, organizations.id))
    .where(and(ne(orders.status, "completed"), ne(orders.dateKind, "backdated"), or(isNotNull(orders.revisedEta), isNotNull(orders.etaGiven))))
    .orderBy(asc(orders.revisedEta), asc(orders.etaGiven))
    .limit(CANDIDATE_LIMIT);

  for (const row of promiseRows) {
    const dueAt = (row.revisedEta ?? row.etaGiven) as Date | null;
    if (!dueAt) continue;
    const receivedAt = (row.enteredAt ?? row.createdAt ?? now) as Date;
    const timezone = row.timezone || "Europe/London";
    const today = todayFor(timezone);
    if (row.dateKind === "preorder") {
      if (currentTradingDay(timezone, dueAt) > today) continue;
    } else if (row.dateKind === "live") {
      if (currentTradingDay(timezone, receivedAt) < today) continue;
    }
    const fulfilmentMethod: "collection" | "delivery" = row.fulfilmentMethod === "delivery" ? "delivery" : "collection";
    // Same carve-out sweepOpsAlerts applies before generating due_soon — a
    // wake hint for an alert the sweep will never actually write would just
    // be a wasted early tick, not a wrong one, but there is no reason to
    // duplicate the discrepancy when shouldAlertDueSoon is right here.
    if (shouldAlertDueSoon({ receivedAt, dueAt, leadMinutes: row.dueSoonLeadMinutes })) {
      consider(new Date(dueAt.getTime() - row.dueSoonLeadMinutes * 60_000));
    }
    const lateApplicable = fulfilmentMethod === "collection" ? !row.readyAt : true;
    if (lateApplicable) consider(new Date(dueAt.getTime() + row.lateGraceMinutes * 60_000));
  }

  const slaRows = await db
    .select({
      dateKind: orders.dateKind,
      createdAt: orders.createdAt,
      enteredAt: orders.enteredAt,
      readyAt: orders.readyAt,
      fulfilmentMethod: orders.fulfilmentMethod,
      timezone: organizations.timezone,
      lateGraceMinutes: organizations.opsLateGraceMinutes,
      prepSlaMinutes: organizations.opsPrepSlaMinutes,
      deliveryLeadMinutes: organizations.opsDeliveryLeadMinutes,
    })
    .from(orders)
    .innerJoin(organizations, eq(orders.orgId, organizations.id))
    .where(
      and(
        ne(orders.status, "completed"),
        ne(orders.dateKind, "backdated"),
        isNull(orders.etaGiven),
        isNull(orders.revisedEta),
        eq(organizations.opsAlertOnSlaDue, true),
      ),
    )
    .orderBy(asc(orders.enteredAt))
    .limit(CANDIDATE_LIMIT);

  for (const row of slaRows) {
    const receivedAt = (row.enteredAt ?? row.createdAt ?? now) as Date;
    const timezone = row.timezone || "Europe/London";
    const today = todayFor(timezone);
    if (row.dateKind === "live" && currentTradingDay(timezone, receivedAt) < today) continue;
    const fulfilmentMethod: "collection" | "delivery" = row.fulfilmentMethod === "delivery" ? "delivery" : "collection";
    const leadMinutes = fulfilmentMethod === "delivery" ? row.deliveryLeadMinutes : row.prepSlaMinutes;
    const dueEffective = new Date(receivedAt.getTime() + leadMinutes * 60_000);
    const lateApplicable = fulfilmentMethod === "collection" ? !row.readyAt : true;
    if (lateApplicable) consider(new Date(dueEffective.getTime() + row.lateGraceMinutes * 60_000));
  }

  return earliest === null ? null : new Date(earliest);
}
