/**
 * Builds the Operations Centre board payload — `GET /api/orders/board`'s
 * response, and the single-row projection the create route and (from N3b/N5a)
 * every other writer feed to `opsBus` after commit.
 *
 * Reads the snake_case schema (`apps/server/src/db/schema.ts`), the same one
 * `GET /api/orders` already reads, because that file is what actually has
 * every operational column declared for `orders` (see the brief's finding
 * G12 and the paired-table rule in `scripts/audit-schema-drift.mjs`).
 * Settings, staff and presence come from `@shared/schema` through the main
 * `server/db` pool instead, because `order_events`, `ops_staff` and the
 * `organizations.ops_*` columns are declared there ONLY — the snake_case
 * `organizations` is a deliberate four-column stub with no business knowing
 * about stations (see shared/schema.ts's own comment above `orderEvents`).
 * Both pools point at the same physical Postgres, so mixing them within one
 * request is the same pattern `GET /api/orders/:id` already uses for refunds.
 *
 * `alerts` (N5a, migration 066): the signed-in user's own unacked, unresolved
 * rows whose order is in `orders` below — see `server/services/opsAlerts.ts`'s
 * `listFor`. `[]` for an anonymous read (no `userId`) or an org with no
 * `ops_alerts` rows yet, never omitted, so the client's `OpsBoardPayload`
 * type never has to treat the field as optional.
 */
import { and, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { organizations, opsStaff, allowedUsers } from "@shared/schema";
import { resolveUserNames } from "./userDisplayName";
import { currentTradingDay } from "@shared/time/tradingDay";
import type { CardState } from "@shared/orders/opsState";
import { deriveCardState } from "@shared/orders/opsState";
import { listFor, type OpsAlertListItem } from "./opsAlerts";

/** Presence: seen within this many minutes counts as "here" (brief, "Stations & presence"). */
const PRESENT_WITHIN_MINUTES = 15;

/** Board orders: open, or completed within this many minutes (the "Done today" tray's window). */
const RECENT_COMPLETED_MINUTES = 120;

export interface OpsBoardSettings {
  prepSlaMinutes: number;
  dueSoonLeadMinutes: number;
  lateGraceMinutes: number;
  deliveryLeadMinutes: number;
  autoClaimOnCreate: boolean;
  alertOnSlaDue: boolean;
  keepScreenAwake: boolean;
  reconcilePollSeconds: number;
}

export interface OpsBoardStaffRow {
  userId: string;
  name: string;
  role: string;
  station: string | null;
  onBreak: boolean;
  lastSeenAt: string | null;
  present: boolean;
  openCount: number;
}

export interface BoardOrderPayload {
  id: string;
  shortCode: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  total: string;
  paymentMethod: string;
  channel: string;
  status: string;
  fulfilmentMethod: "collection" | "delivery";
  dateKind: "live" | "backdated" | "preorder";
  createdAt: string;
  enteredAt: string | null;
  etaGiven: string | null;
  originalEta: string | null;
  revisedEta: string | null;
  delayFlag: boolean;
  delayCause: string | null;
  delayReason: string | null;
  delayNotificationSentAt: string | null;
  delayResolution: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedAt: string | null;
  heldAt: string | null;
  readyAt: string | null;
  customerArrivedAt: string | null;
  outForDeliveryAt: string | null;
  settledAt: string | null;
  handoverAt: string | null;
  inputUserId: string | null;
  inputUserName: string | null;
  completedUserId: string | null;
  completedUserName: string | null;
  locationId: string | null;
  itemCount: number;
  /** First few order lines, formatted "<qty>× <name>" — see the module doc for why the shape is free here. */
  itemsPreview: string[];
  updatedAt: string | null;
}

export interface OpsBoardSummary {
  open: number;
  collection: number;
  delivery: number;
  unassigned: number;
  mine: number;
  lateNow: number;
  dueSoonNow: number;
  readyWaiting: number;
  carriedOver: number;
  completedToday: number;
}

export interface OpsBoardPayload {
  serverNow: string;
  tradingDay: string;
  timezone: string;
  settings: OpsBoardSettings;
  me: { userId: string | null; station: string | null; onBreak: boolean };
  staff: OpsBoardStaffRow[];
  orders: BoardOrderPayload[];
  alerts: OpsAlertListItem[];
  summary: OpsBoardSummary;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

type RawOrderRow = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  total: string;
  paymentMethod: string;
  channel: string | null;
  status: string | null;
  fulfilmentMethod: string | null;
  dateKind: string | null;
  createdAt: Date | null;
  enteredAt: Date | null;
  etaGiven: Date | null;
  originalEta: Date | null;
  revisedEta: Date | null;
  delayFlag: boolean | null;
  delayCause: string | null;
  delayReason: string | null;
  delayNotificationSentAt: Date | null;
  delayResolution: string | null;
  assignedUserId: string | null;
  assignedAt: Date | null;
  heldAt: Date | null;
  readyAt: Date | null;
  customerArrivedAt: Date | null;
  outForDeliveryAt: Date | null;
  settledAt: Date | null;
  inputUserId: string | null;
  completedUserId: string | null;
  locationId: string | null;
  updatedAt: Date | null;
};

/** `apps/server/src/db`'s `orders`/`customers`, selected in the shape `projectBoardOrder` needs. */
async function selectBoardRows(orgId: string, cutoff: Date): Promise<RawOrderRow[]> {
  const { db } = await import("../../apps/server/src/db");
  const { orders, customers } = await import("../../apps/server/src/db/schema");
  const rows = await db
    .select({
      id: orders.id,
      customerId: orders.customer_id,
      customerName: customers.name,
      customerPhone: customers.phone,
      total: orders.total,
      paymentMethod: orders.payment_method,
      channel: orders.channel,
      status: orders.status,
      fulfilmentMethod: orders.fulfilment_method,
      dateKind: orders.date_kind,
      createdAt: orders.created_at,
      enteredAt: orders.entered_at,
      etaGiven: orders.eta_given,
      originalEta: orders.original_eta,
      revisedEta: orders.revised_eta,
      delayFlag: orders.delay_flag,
      delayCause: orders.delay_cause,
      delayReason: orders.delay_reason,
      delayNotificationSentAt: orders.delay_notification_sent_at,
      delayResolution: orders.delay_resolution,
      assignedUserId: orders.assigned_user_id,
      assignedAt: orders.assigned_at,
      heldAt: orders.held_at,
      readyAt: orders.ready_at,
      customerArrivedAt: orders.customer_arrived_at,
      outForDeliveryAt: orders.out_for_delivery_at,
      settledAt: orders.settled_at,
      inputUserId: orders.input_user_id,
      completedUserId: orders.completed_user_id,
      locationId: orders.location_id,
      updatedAt: orders.updated_at,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customer_id, customers.id))
    .where(
      and(
        eq(orders.org_id, orgId),
        or(ne(orders.status, "completed"), gte(orders.settled_at, cutoff)),
      ),
    )
    .orderBy(orders.created_at);
  return rows as unknown as RawOrderRow[];
}

interface ItemAggregate {
  count: number;
  preview: string[];
}

/**
 * Line counts and a short preview per order, in one query rather than one
 * per card — the difference between the board staying under the 150ms DoD at
 * 2,000 open orders and not.
 */
async function selectItemAggregates(orderIds: string[]): Promise<Map<string, ItemAggregate>> {
  const result = new Map<string, ItemAggregate>();
  if (orderIds.length === 0) return result;
  const { db } = await import("../../apps/server/src/db");
  const { order_items, products } = await import("../../apps/server/src/db/schema");
  const rows = await db
    .select({
      orderId: order_items.order_id,
      quantity: order_items.quantity,
      productName: products.name,
      createdAt: order_items.created_at,
    })
    .from(order_items)
    .leftJoin(products, eq(order_items.product_id, products.id))
    .where(inArray(order_items.order_id, orderIds))
    .orderBy(order_items.created_at);

  for (const row of rows) {
    const orderId = row.orderId as string | null;
    if (!orderId) continue;
    const entry = result.get(orderId) ?? { count: 0, preview: [] };
    entry.count += 1;
    if (entry.preview.length < 2) {
      const qty = Number(row.quantity ?? 0);
      const name = row.productName || "Item";
      entry.preview.push(`${qty}× ${name}`);
    }
    result.set(orderId, entry);
  }
  return result;
}

/**
 * `handoverAt = COALESCE(order_events.completed.meta.actualAt, settled_at)`
 * (brief, "Derived"). No writer sets `meta.actualAt` until N3b's
 * `orderCompletion.ts`, so this resolves to `settledAt` for every order today
 * — but it is wired up now so N3b needs no change here when it starts writing
 * that meta key.
 */
async function selectActualHandoverTimes(orgId: string, completedOrderIds: string[]): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();
  if (completedOrderIds.length === 0) return result;
  const { db: mainDb } = await import("../db");
  const { orderEvents } = await import("@shared/schema");
  const rows = await mainDb
    .select({ orderId: orderEvents.orderId, at: orderEvents.at, meta: orderEvents.meta })
    .from(orderEvents)
    .where(
      and(
        eq(orderEvents.orgId, orgId),
        eq(orderEvents.kind, "completed"),
        inArray(orderEvents.orderId, completedOrderIds),
      ),
    )
    .orderBy(desc(orderEvents.at));
  const seen = new Set<string>();
  for (const row of rows) {
    // Rows arrive newest-first, so the first row seen for an order IS its
    // current completion — a resettle after `reopen` writes a new `completed`
    // row rather than mutating the old one, so an order can have several.
    // Only that current row's `actualAt` is live; an older completion's
    // `actualAt` was superseded the moment the order was reopened, so once
    // we've looked at the newest row for an order we must stop, whether or
    // not it carried an override — never fall through to an earlier row.
    if (seen.has(row.orderId)) continue;
    seen.add(row.orderId);
    const actualAt = (row.meta as { actualAt?: string } | null)?.actualAt;
    if (actualAt) result.set(row.orderId, new Date(actualAt));
  }
  return result;
}

function projectBoardOrder(
  row: RawOrderRow,
  names: Map<string, string>,
  items: ItemAggregate | undefined,
  handoverOverride: Date | undefined,
): BoardOrderPayload {
  const fulfilmentMethod: "collection" | "delivery" = row.fulfilmentMethod === "delivery" ? "delivery" : "collection";
  const dateKind: "live" | "backdated" | "preorder" =
    row.dateKind === "preorder" || row.dateKind === "backdated" ? row.dateKind : "live";
  return {
    id: row.id,
    shortCode: row.id.slice(0, 8),
    customerId: row.customerId,
    customerName: row.customerName?.trim() ? row.customerName.trim() : null,
    customerPhone: row.customerPhone ?? null,
    total: row.total,
    paymentMethod: row.paymentMethod,
    channel: row.channel ?? "pos",
    status: row.status ?? "pending",
    fulfilmentMethod,
    dateKind,
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    enteredAt: iso(row.enteredAt),
    etaGiven: iso(row.etaGiven),
    originalEta: iso(row.originalEta),
    revisedEta: iso(row.revisedEta),
    delayFlag: row.delayFlag === true,
    delayCause: row.delayCause ?? null,
    delayReason: row.delayReason ?? null,
    delayNotificationSentAt: iso(row.delayNotificationSentAt),
    delayResolution: row.delayResolution ?? null,
    assignedUserId: row.assignedUserId,
    assignedUserName: row.assignedUserId ? (names.get(row.assignedUserId) ?? row.assignedUserId) : null,
    assignedAt: iso(row.assignedAt),
    heldAt: iso(row.heldAt),
    readyAt: iso(row.readyAt),
    customerArrivedAt: iso(row.customerArrivedAt),
    outForDeliveryAt: iso(row.outForDeliveryAt),
    settledAt: iso(row.settledAt),
    handoverAt: iso(handoverOverride ?? row.settledAt),
    inputUserId: row.inputUserId,
    inputUserName: row.inputUserId ? (names.get(row.inputUserId) ?? row.inputUserId) : null,
    completedUserId: row.completedUserId,
    completedUserName: row.completedUserId ? (names.get(row.completedUserId) ?? row.completedUserId) : null,
    locationId: row.locationId,
    itemCount: items?.count ?? 0,
    itemsPreview: items?.preview ?? [],
    updatedAt: iso(row.updatedAt),
  };
}

async function loadOrgSettings(orgId: string): Promise<{ timezone: string; settings: OpsBoardSettings }> {
  const { db: mainDb } = await import("../db");
  const [org] = await mainDb
    .select({
      timezone: organizations.timezone,
      opsPrepSlaMinutes: organizations.opsPrepSlaMinutes,
      opsDueSoonLeadMinutes: organizations.opsDueSoonLeadMinutes,
      opsLateGraceMinutes: organizations.opsLateGraceMinutes,
      opsDeliveryLeadMinutes: organizations.opsDeliveryLeadMinutes,
      opsAutoClaimOnCreate: organizations.opsAutoClaimOnCreate,
      opsReconcilePollSeconds: organizations.opsReconcilePollSeconds,
      opsAlertOnSlaDue: organizations.opsAlertOnSlaDue,
      opsKeepScreenAwake: organizations.opsKeepScreenAwake,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  return {
    timezone: org?.timezone || "Europe/London",
    settings: {
      prepSlaMinutes: org?.opsPrepSlaMinutes ?? 20,
      dueSoonLeadMinutes: org?.opsDueSoonLeadMinutes ?? 10,
      lateGraceMinutes: org?.opsLateGraceMinutes ?? 5,
      deliveryLeadMinutes: org?.opsDeliveryLeadMinutes ?? 45,
      autoClaimOnCreate: org?.opsAutoClaimOnCreate ?? true,
      alertOnSlaDue: org?.opsAlertOnSlaDue ?? false,
      keepScreenAwake: org?.opsKeepScreenAwake ?? true,
      reconcilePollSeconds: org?.opsReconcilePollSeconds ?? 60,
    },
  };
}

/**
 * `allowed_users` of the org, minus CUSTOMER, joined to `ops_staff` —
 * exactly the brief's definition. `openCount` comes from the board rows
 * already fetched rather than a second query against `orders`.
 */
async function loadStaff(orgId: string, openByAssignee: Map<string, number>, now: Date): Promise<OpsBoardStaffRow[]> {
  const { db: mainDb } = await import("../db");
  const [people, stationRows] = await Promise.all([
    mainDb
      .select({
        authUserId: allowedUsers.authUserId,
        replitUserId: allowedUsers.replitUserId,
        name: allowedUsers.name,
        email: allowedUsers.email,
        role: allowedUsers.role,
      })
      .from(allowedUsers)
      .where(and(eq(allowedUsers.orgId, orgId), ne(allowedUsers.role, "CUSTOMER"))),
    mainDb.select().from(opsStaff).where(eq(opsStaff.orgId, orgId)),
  ]);

  const stationByUser = new Map(stationRows.map((row) => [row.userId, row]));
  const presentCutoff = now.getTime() - PRESENT_WITHIN_MINUTES * 60_000;

  return people
    .map((person): OpsBoardStaffRow => {
      // Auth subject: prefer authUserId (Clerk), fall back to the legacy
      // replitUserId — the same effective id `allowedUserSubjectWhere` in
      // storage.ts resolves either column to.
      const userId = person.authUserId || person.replitUserId || "";
      const station = stationByUser.get(userId);
      const lastSeenAt = station?.lastSeenAt ?? null;
      const present = lastSeenAt != null && lastSeenAt.getTime() >= presentCutoff;
      return {
        userId,
        name: person.name?.trim() || person.email || userId,
        role: String(person.role ?? "CASHIER"),
        station: station?.station ?? null,
        onBreak: station?.onBreak ?? false,
        lastSeenAt: iso(lastSeenAt),
        present,
        openCount: openByAssignee.get(userId) ?? 0,
      };
    })
    .filter((row): row is OpsBoardStaffRow => Boolean(row.userId));
}

export interface GetOpsBoardOptions {
  now?: Date;
}

/** The full `GET /api/orders/board` payload for one org, as one signed-in user sees it. */
export async function getOpsBoard(
  orgId: string,
  userId: string | null,
  options: GetOpsBoardOptions = {},
): Promise<OpsBoardPayload> {
  const now = options.now ?? new Date();
  const { timezone, settings } = await loadOrgSettings(orgId);
  const cutoff = new Date(now.getTime() - RECENT_COMPLETED_MINUTES * 60_000);

  const rows = await selectBoardRows(orgId, cutoff);
  const orderIds = rows.map((r) => r.id);
  const completedIds = rows.filter((r) => r.status === "completed").map((r) => r.id);

  const [items, handoverOverrides] = await Promise.all([
    selectItemAggregates(orderIds),
    selectActualHandoverTimes(orgId, completedIds),
  ]);

  const nameIds = new Set<string>();
  for (const row of rows) {
    if (row.inputUserId) nameIds.add(row.inputUserId);
    if (row.completedUserId) nameIds.add(row.completedUserId);
    if (row.assignedUserId) nameIds.add(row.assignedUserId);
  }
  const names = await resolveUserNames(nameIds);

  const orders = rows.map((row) =>
    projectBoardOrder(row, names, items.get(row.id), handoverOverrides.get(row.id)),
  );

  const openByAssignee = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "completed" || !row.assignedUserId) continue;
    openByAssignee.set(row.assignedUserId, (openByAssignee.get(row.assignedUserId) ?? 0) + 1);
  }
  const staff = await loadStaff(orgId, openByAssignee, now);

  const me = userId ? staff.find((s) => s.userId === userId) ?? null : null;

  const timingSettings = {
    timezone,
    prepSlaMinutes: settings.prepSlaMinutes,
    dueSoonLeadMinutes: settings.dueSoonLeadMinutes,
    lateGraceMinutes: settings.lateGraceMinutes,
    deliveryLeadMinutes: settings.deliveryLeadMinutes,
  };
  const derivedStates = new Map<string, CardState>();
  for (const order of orders) {
    derivedStates.set(
      order.id,
      deriveCardState(
        {
          status: order.status,
          fulfilmentMethod: order.fulfilmentMethod,
          dateKind: order.dateKind,
          createdAt: order.createdAt,
          enteredAt: order.enteredAt,
          etaGiven: order.etaGiven,
          revisedEta: order.revisedEta,
          delayFlag: order.delayFlag,
          heldAt: order.heldAt,
          readyAt: order.readyAt,
          customerArrivedAt: order.customerArrivedAt,
          outForDeliveryAt: order.outForDeliveryAt,
          settledAt: order.settledAt,
          handoverAt: order.handoverAt,
        },
        now,
        timingSettings,
      ).state,
    );
  }

  const open = orders.filter((o) => o.status !== "completed");
  const summary: OpsBoardSummary = {
    open: open.length,
    collection: open.filter((o) => o.fulfilmentMethod === "collection").length,
    delivery: open.filter((o) => o.fulfilmentMethod === "delivery").length,
    unassigned: open.filter((o) => !o.assignedUserId).length,
    mine: userId ? open.filter((o) => o.assignedUserId === userId).length : 0,
    lateNow: open.filter((o) => derivedStates.get(o.id) === "late" || derivedStates.get(o.id) === "customer-waiting").length,
    dueSoonNow: open.filter((o) => derivedStates.get(o.id) === "due-soon").length,
    readyWaiting: open.filter((o) => derivedStates.get(o.id) === "ready").length,
    carriedOver: open.filter((o) => derivedStates.get(o.id) === "carried-over").length,
    completedToday: orders.filter((o) => o.status === "completed").length,
  };

  // "my rows, unacked, unresolved, whose order is in `orders`" (brief) — the
  // last clause is `orders.map(o => o.id)`, not a second, looser query: an
  // alert for a row that has already aged out of the board (past the
  // "Done today" window, say) must not surface here either.
  const alerts = await listFor(orgId, userId, orders.map((o) => o.id));

  return {
    serverNow: now.toISOString(),
    tradingDay: currentTradingDay(timezone, now),
    timezone,
    settings,
    me: { userId, station: me?.station ?? null, onBreak: me?.onBreak ?? false },
    staff,
    orders,
    alerts,
    summary,
  };
}

/**
 * One board row, freshly read — what the create route (and, from N3b/N5a,
 * every other writer) hands to `opsBus.publishOpsEvent` after its transaction
 * commits. A single-row re-read rather than reusing an in-memory value keeps
 * this the same source of truth `GET /api/orders/board` uses, so a card
 * pushed over the stream can never disagree with one fetched by a poll.
 */
export async function getOpsBoardOrder(orgId: string, orderId: string): Promise<BoardOrderPayload | null> {
  const { db } = await import("../../apps/server/src/db");
  const { orders, customers } = await import("../../apps/server/src/db/schema");
  const [row] = await db
    .select({
      id: orders.id,
      customerId: orders.customer_id,
      customerName: customers.name,
      customerPhone: customers.phone,
      total: orders.total,
      paymentMethod: orders.payment_method,
      channel: orders.channel,
      status: orders.status,
      fulfilmentMethod: orders.fulfilment_method,
      dateKind: orders.date_kind,
      createdAt: orders.created_at,
      enteredAt: orders.entered_at,
      etaGiven: orders.eta_given,
      originalEta: orders.original_eta,
      revisedEta: orders.revised_eta,
      delayFlag: orders.delay_flag,
      delayCause: orders.delay_cause,
      delayReason: orders.delay_reason,
      delayNotificationSentAt: orders.delay_notification_sent_at,
      delayResolution: orders.delay_resolution,
      assignedUserId: orders.assigned_user_id,
      assignedAt: orders.assigned_at,
      heldAt: orders.held_at,
      readyAt: orders.ready_at,
      customerArrivedAt: orders.customer_arrived_at,
      outForDeliveryAt: orders.out_for_delivery_at,
      settledAt: orders.settled_at,
      inputUserId: orders.input_user_id,
      completedUserId: orders.completed_user_id,
      locationId: orders.location_id,
      updatedAt: orders.updated_at,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customer_id, customers.id))
    .where(and(eq(orders.id, orderId), eq(orders.org_id, orgId)))
    .limit(1);
  if (!row) return null;

  const [items, names, handoverOverrides] = await Promise.all([
    selectItemAggregates([row.id as string]),
    resolveUserNames(
      [row.inputUserId, row.completedUserId, row.assignedUserId].filter((v): v is string => Boolean(v)),
    ),
    row.status === "completed" ? selectActualHandoverTimes(orgId, [row.id as string]) : Promise.resolve(new Map<string, Date>()),
  ]);

  return projectBoardOrder(row as unknown as RawOrderRow, names, items.get(row.id as string), handoverOverrides.get(row.id as string));
}
