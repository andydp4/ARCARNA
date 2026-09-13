/**
 * Operations Centre journey fixtures (Phase N, package N8).
 *
 * Every Operations Centre journey needs the same three things and none of them
 * are cheap to write twice: an order sitting in a named card state, a second
 * member of staff who is not the seeded cashier, and the headers to act as an
 * arbitrary user. They live here rather than in `fixtures.ts` because that file
 * is the whole suite's shared ground — `apiAs`, `pageAs`, `authHeaders`,
 * `ensureOpenShift`, `firstLocationId`, `placeOrder`, `okJson`, `uniqueSuffix`
 * — and this file is one feature's. Nothing here re-implements any of those;
 * they are imported and used.
 *
 * ## Read docs/testing/FAKE_TIME.md before using `orderInState`
 *
 * The single most expensive mistake available in this area is faking time in
 * the browser and expecting the server to agree. `orderInState` therefore
 * deals only in REAL instants: `{ dueIn: 9 }` means a promise nine real
 * minutes from now, which is what makes a server-side alert sweep actually
 * fire. There is no clock to wind forward here, and adding one would make
 * these fixtures lie.
 *
 * ## Why this file degrades instead of pretending
 *
 * N8 lands on day one, before N2 adds `ready_at`, `held_at`,
 * `customer_arrived_at`, `out_for_delivery_at` and `assigned_user_id`, and
 * before N3a/N3b add the endpoints that write them. Rather than guess at those
 * columns, `orderInState` asks the database which of them exist
 * (`orderColumns`), uses them when they do, and records a caveat when they do
 * not. So:
 *
 *   - today, `orderInState(api, db, "ready", …)` gets as close as the schema
 *     allows (`status = 'awaiting-customer'`) and says so in `handle.caveats`;
 *   - the day migration 065 lands, the same call stamps `ready_at` for real
 *     with no edit to this file or to any spec that uses it.
 *
 * `handle.achieved` is not the caller's wish — it is `deriveCardState` run
 * over the row as the database actually holds it. A spec that needs the real
 * thing can assert `handle.achieved === "ready"` (or skip on the caveat) and
 * will start passing when the column arrives, instead of passing today for the
 * wrong reason. `assertAchieved(handle)` is the one-liner for that.
 *
 * Extending this file is expected: N3b, N4a and N5a each own it in turn (see
 * the brief's delivery plan). Add a recipe to `applyState`, not a parallel
 * helper.
 */
import { expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import {
  deriveCardState,
  type CardState,
  type FulfilmentMethod,
  type OpsOrderInput,
  type OpsTimingSettings,
} from "@shared/orders/opsState";
import { allowedUsers, organizations } from "@shared/schema";
import {
  ensureOpenShift,
  firstLocationId,
  okJson,
  placeOrder,
  test as journeyTest,
  uniqueSuffix,
} from "./fixtures";

/**
 * The drizzle handle, passed in rather than imported, exactly as the brief's
 * call convention has it (`orderInState(api, db, …)`). Specs import it
 * themselves — `import { db } from "../../server/db"` — the way
 * `security/tenants.ts` already does. Passing it keeps this module free of a
 * module-level database connection, so importing it never opens a pool.
 *
 * `typeof import(...)` is a type-only reference: nothing is loaded at runtime.
 */
export type OpsDb = (typeof import("../../server/db"))["db"];

/** Every row this module creates carries this prefix, so strays are obvious. */
export const OPS_PREFIX = "ZZ-OPS";

/**
 * The org defaults the owner signed off (brief, Owner's answers Q5). Used
 * until N2 puts `ops_*` on `organizations` and the board reports them; the
 * timezone is always read from the real org row, never assumed.
 */
export const DEFAULT_OPS_TIMING: Omit<OpsTimingSettings, "timezone"> = {
  prepSlaMinutes: 20,
  deliveryLeadMinutes: 45,
  dueSoonLeadMinutes: 10,
  lateGraceMinutes: 5,
};

// --------------------------------------------------------------- impersonation

const TEST_SECRET = process.env.PHASE2D_TEST_SECRET ?? "journey-suite-local-secret";

/**
 * Impersonation headers for ANY user id — the arbitrary-user sibling of
 * `authHeaders(role, orgId)`, which is keyed on the four seeded ids in
 * `ROLE_USERS`.
 *
 * The server does not care which id this is. `tryPhase2dTestAuth`
 * (server/auth/commonAuth.ts:15-47) checks four things — PHASE2D_TEST=1, a
 * non-production NODE_ENV, a localhost peer, and a matching `x-test-secret` —
 * and then looks the id up with `storage.getUserRoleAndOrg(testUserId)`. Any
 * id in `allowed_users` is honoured with that row's role and org; an id that
 * is NOT in `allowed_users` gets 401 "Test user not found in allowed_users",
 * which is precisely why `secondCashier` inserts a row rather than inventing a
 * string.
 */
export function headersFor(userId: string, orgId?: string): Record<string, string> {
  return {
    "x-test-replit-user-id": userId,
    "x-test-secret": TEST_SECRET,
    ...(orgId ? { "x-org-id": orgId } : {}),
  };
}

/** An API context acting as an arbitrary user id — `apiAs` for non-seeded staff. */
export async function apiForUser(userId: string, orgId?: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000",
    extraHTTPHeaders: headersFor(userId, orgId),
  });
}

// ------------------------------------------------------------- a second person

export interface OpsStaffMember {
  /** The auth subject — what `assigned_user_id`, `input_user_id` and `completed_user_id` all hold. */
  userId: string;
  name: string;
  email: string;
  role: "CASHIER";
  orgId: string;
  /** Ready-made impersonation headers for this person. */
  headers: Record<string, string>;
  /** Removes the `allowed_users` row. Safe to call twice. */
  cleanup(): Promise<void>;
}

const createdStaff: Array<{ userId: string; db: OpsDb }> = [];

/**
 * A second, real member of staff in the same org as the seeded cashier.
 *
 * The seed creates exactly four users (scripts/seed.ts:75-79) and every one of
 * them is a different ROLE, not a different colleague. A claim race, a "Sam
 * took #4821" conflict, and "A sees A's alert, B does not" all need two people
 * of the SAME role, so one has to be made. Inserted directly for the same
 * reason `security/tenants.ts` inserts org B directly: the route that would
 * create one sits behind checks a test cannot satisfy, and everything that
 * matters afterwards still goes through the HTTP API.
 *
 * The row is shaped like the seeded four — `replit_user_id`, `email`, `name`,
 * `is_owner`, `org_id`, `role` — so `storage.getUserRoleAndOrg` resolves it
 * and impersonation works immediately.
 *
 * `orgId` defaults to the org `seed-admin` belongs to, which is the org every
 * journey works in.
 */
export async function secondCashier(db: OpsDb, orgId?: string): Promise<OpsStaffMember> {
  const resolvedOrgId = orgId ?? (await seedAdminOrgId(db));
  const suffix = uniqueSuffix();
  const userId = `${OPS_PREFIX}-cashier-${suffix}`;
  const member: OpsStaffMember = {
    userId,
    name: `${OPS_PREFIX} Second Cashier ${suffix}`,
    email: `ops-second-${suffix}@seed.local`,
    role: "CASHIER",
    orgId: resolvedOrgId,
    headers: headersFor(userId, resolvedOrgId),
    cleanup: async () => {
      await db.delete(allowedUsers).where(eq(allowedUsers.replitUserId, userId));
    },
  };

  await db.insert(allowedUsers).values({
    replitUserId: member.userId,
    email: member.email,
    name: member.name,
    isOwner: 0,
    orgId: resolvedOrgId,
    role: "CASHIER",
  });
  createdStaff.push({ userId, db });
  return member;
}

/**
 * Deletes every `allowed_users` row `secondCashier` created in this worker.
 *
 * Call from `test.afterAll`. Left-behind rows are not dangerous — they are
 * inert until somebody impersonates them — but they accumulate across reruns
 * against a long-lived local database and make `/api/users` noisy.
 */
export async function cleanupOpsStaff(): Promise<void> {
  while (createdStaff.length > 0) {
    const entry = createdStaff.pop()!;
    await entry.db.delete(allowedUsers).where(eq(allowedUsers.replitUserId, entry.userId));
  }
}

/**
 * The journey `test`, plus a second cashier that cleans itself up.
 *
 * Same `test.extend` shape as `fixtures.ts` uses for `api`, `orgId` and
 * `adminPage`, so a spec that needs two people writes
 * `opsTest("A and B", async ({ api, cashierB }) => …)` and never has to
 * remember an `afterAll`. `server/db` is imported inside the fixture rather
 * than at the top of this module so that importing `opsFixtures` — which a
 * pure-UI spec might do for `headersFor` alone — never opens a pool.
 */
export const opsTest = journeyTest.extend<{ cashierB: OpsStaffMember }>({
  cashierB: async ({ orgId }, use) => {
    const { db } = await import("../../server/db");
    const member = await secondCashier(db, orgId);
    await use(member);
    await member.cleanup();
  },
});

/** The org `seed-admin` belongs to — the one every journey works in. */
async function seedAdminOrgId(db: OpsDb): Promise<string> {
  const [row] = await db
    .select({ orgId: allowedUsers.orgId })
    .from(allowedUsers)
    .where(eq(allowedUsers.replitUserId, "seed-admin"))
    .limit(1);
  if (!row?.orgId) {
    throw new Error("seed-admin has no org — run `npm run seed` against this database.");
  }
  return row.orgId;
}

// ------------------------------------------------------------- org and columns

let timingCache: Map<string, OpsTimingSettings> | null = null;

/**
 * The timing settings `deriveCardState` needs, with the org's REAL timezone.
 *
 * The four minute figures are the agreed defaults until N2 puts `ops_*`
 * columns on `organizations`; the timezone is read from the row because
 * trading-day boundaries are the one thing here that must never be assumed
 * (see shared/time/tradingDay.ts and docs/testing/FAKE_TIME.md).
 */
export async function opsTimingSettings(
  db: OpsDb,
  orgId: string,
  overrides: Partial<OpsTimingSettings> = {},
): Promise<OpsTimingSettings> {
  timingCache ??= new Map();
  let base = timingCache.get(orgId);
  if (!base) {
    const [org] = await db
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    base = { timezone: org?.timezone ?? "Europe/London", ...DEFAULT_OPS_TIMING };
    timingCache.set(orgId, base);
  }
  return { ...base, ...overrides };
}

/**
 * The stage columns N2's migration 065 adds. Everything in this list is
 * optional TODAY and mandatory afterwards, and this file's job is to behave
 * correctly in both worlds.
 */
const STAGE_COLUMNS = [
  "assigned_user_id",
  "held_at",
  "ready_at",
  "customer_arrived_at",
  "out_for_delivery_at",
] as const;

/**
 * `db.execute`'s return shape differs between the node-postgres and neon
 * drivers (a bare array vs. `{ rows }`) — this normalises it once rather than
 * repeating the `Array.isArray` check at every call site.
 */
async function queryRows<T>(db: OpsDb, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

let orderColumnsCache: Set<string> | null = null;

/**
 * Which columns `orders` actually has right now.
 *
 * This is the seam that lets one fixture serve the whole phase. Asking the
 * database costs one query per worker and is the only answer that cannot go
 * stale: a hard-coded "N2 has landed" flag would have to be flipped by hand in
 * the PR that lands it, and would be wrong on every branch that has not
 * rebased.
 */
export async function orderColumns(db: OpsDb): Promise<Set<string>> {
  if (orderColumnsCache) return orderColumnsCache;
  const rows = await queryRows<{ column_name: string }>(
    db,
    sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'orders'`,
  );
  orderColumnsCache = new Set(rows.map((r) => r.column_name));
  return orderColumnsCache;
}

// ------------------------------------------------------------------ the order

export interface OrderInStateOptions {
  /** Which lane. Default "collection" — the till's own default and the column's. */
  fulfilment?: FulfilmentMethod;
  /** How long ago the order was received, in REAL minutes. Backdates `entered_at`. */
  minutesAgo?: number;
  /**
   * The promise, in REAL minutes from now. Negative means the promise has
   * already passed. Omitted, each state picks a figure that puts the card
   * unambiguously in that state under `DEFAULT_OPS_TIMING`.
   */
  dueIn?: number;
  /** Who is dealing with it (an auth subject id, e.g. from `secondCashier`). */
  assignedTo?: string;
  /** How the order arrived. Default "pos". */
  channel?: "pos" | "web" | "api" | "whatsapp" | "phone";
  locationId?: string;
  customerId?: string;
  quantity?: number;
  unitPrice?: number;
  paymentMethod?: "cash" | "card" | "transfer";
  /** The instant `achieved` is computed against. Defaults to real now. */
  now?: Date;
  /** Per-case timing overrides, e.g. a shorter due-soon lead. */
  settings?: Partial<OpsTimingSettings>;
}

export interface OpsOrderHandle {
  id: string;
  orgId: string;
  locationId: string;
  /** The state the caller asked for. */
  requested: CardState;
  /** The state `deriveCardState` gives the row as the database actually holds it. */
  achieved: CardState;
  /** Non-empty when today's schema could not express `requested` exactly. */
  caveats: string[];
  receivedAt: Date;
  dueAt: Date | null;
  assignedUserId: string | null;
  /** The row, in the shape N0's contract defines. */
  input: OpsOrderInput;
  settings: OpsTimingSettings;
}

/**
 * Fails the test when the fixture could not build the state that was asked
 * for. Use it in specs whose assertion only means something in the real state
 * — the alternative is a green test proving nothing.
 */
export function assertAchieved(handle: OpsOrderHandle): OpsOrderHandle {
  expect(
    handle.achieved,
    `orderInState could not build "${handle.requested}" on today's schema: ${
      handle.caveats.join("; ") || "no reason recorded"
    }`,
  ).toBe(handle.requested);
  return handle;
}

/**
 * Places a REAL order through the ordinary API and moves it into `state`.
 *
 * Creation is always the real thing — `ensureOpenShift` then `POST /api/orders`
 * — so the row carries a shift, a cashier shift, tender legs, an outbox event
 * and everything else a genuine sale does. Only what no endpoint can express
 * yet is written directly with drizzle, and each such write is named in
 * `handle.caveats` when it stands in for something the schema does not have.
 *
 *   const late = await orderInState(api, db, "late", { dueIn: -20 });
 *   const soon = await orderInState(api, db, "due-soon", { dueIn: 9 });
 *
 * `dueIn` is in real minutes because the alert sweep runs in the server
 * process on the wall clock. See docs/testing/FAKE_TIME.md.
 */
export async function orderInState(
  api: APIRequestContext,
  db: OpsDb,
  state: CardState,
  opts: OrderInStateOptions = {},
): Promise<OpsOrderHandle> {
  const now = opts.now ?? new Date();
  const orgId = await seedAdminOrgId(db);
  const settings = await opsTimingSettings(db, orgId, opts.settings);
  const locationId = opts.locationId ?? (await firstLocationId(api));
  await ensureOpenShift(api, locationId);
  const product = await opsProduct(api, locationId);
  const caveats: string[] = [];

  const recipe = RECIPES[state];
  const fulfilment = opts.fulfilment ?? "collection";
  const dueIn = opts.dueIn ?? recipe.dueIn;
  const dueAt = dueIn === null ? null : new Date(now.getTime() + dueIn * 60_000);

  // `orderDate` is the only creation-time lever that changes `date_kind`, and a
  // scheduled card is a pre-order by definition (brief, "Pre-orders").
  const orderDate = recipe.preorderDaysAhead
    ? isoDateIn(settings.timezone, addDays(now, recipe.preorderDaysAhead))
    : undefined;
  // N3a landed the rule this file's own TODO anticipated: a pre-order 400s
  // without a due time on its own day. Midday is arbitrary and safely inside
  // every trading day regardless of timezone or DST.
  const preorderDueTime = recipe.preorderDaysAhead ? "12:00" : undefined;

  const created = await okJson<{ orderId?: string; id?: string; order?: { id?: string } }>(
    await placeOrder(
      api,
      locationId,
      [
        {
          productId: product.id,
          quantity: opts.quantity ?? 1,
          unitPrice: opts.unitPrice ?? product.unitPrice,
        },
      ],
      opts.paymentMethod ?? "cash",
      {
        fulfilmentMethod: fulfilment,
        channel: opts.channel ?? "pos",
        ...(opts.customerId ? { customerId: opts.customerId } : {}),
        ...(orderDate ? { orderDate } : {}),
        ...(preorderDueTime ? { dueTime: preorderDueTime } : {}),
        // N3a: the create route resolves this into `eta_given` itself now —
        // the direct-write fallback in `applyState` below simply never finds
        // work to do for any state this already covers.
        ...(dueIn !== null && dueIn > 0 && !preorderDueTime ? { dueInMinutes: dueIn } : {}),
      },
    ),
  );
  const orderId = created.orderId ?? created.id ?? created.order?.id;
  if (!orderId) {
    throw new Error(`POST /api/orders returned no id: ${JSON.stringify(created)}`);
  }

  await applyState(api, db, {
    orderId,
    orgId,
    state,
    recipe,
    now,
    dueAt,
    timezone: settings.timezone,
    minutesAgo: opts.minutesAgo,
    assignedTo: opts.assignedTo,
    caveats,
  });

  const { input, assignedUserId } = await readOpsOrder(db, orgId, orderId);
  const derived = deriveCardState(input, now, settings);
  if (derived.state !== state) {
    caveats.push(
      `deriveCardState says "${derived.state}", not "${state}" — see the recipe for this state in opsFixtures.ts`,
    );
  }

  return {
    id: orderId,
    orgId,
    locationId,
    requested: state,
    achieved: derived.state,
    caveats,
    receivedAt: derived.receivedAt,
    dueAt: derived.dueAt,
    assignedUserId,
    input,
    settings,
  };
}

/**
 * How each card state is reached on today's schema.
 *
 * `dueIn` is the default promise offset in minutes (null = no promise at all,
 * which is the "No time given" SLA case). `status` is what
 * `PATCH /api/orders/:id {status}` is asked for. `needsColumns` names the
 * columns the state genuinely requires — when one is missing the fixture says
 * so rather than quietly producing a different card.
 *
 * TODO(N3b): once `POST /api/orders/:id/transition` exists, every one of these
 * should drive the state through the real action (`ready`, `arrived`,
 * `out_for_delivery`, `hold`, `complete`) instead of a status PATCH plus a
 * timestamp write — the transitions write `order_events` and publish
 * `OrderStageChanged`, which a status PATCH does not, so a spec about events
 * cannot use these recipes until then.
 */
type Recipe = {
  /** Minutes from now for the promise; null = no promise. */
  dueIn: number | null;
  status?: "pending" | "on-hold" | "awaiting-customer" | "urgent" | "completed";
  /** Stage timestamps to stamp at `now`, when the columns exist. */
  stamp?: Array<(typeof STAGE_COLUMNS)[number]>;
  /** Columns without which the state cannot be built at all. */
  needsColumns?: Array<(typeof STAGE_COLUMNS)[number]>;
  /** Set `delay_flag` and push `revised_eta` out. */
  delayed?: boolean;
  /** Rewrite `created_at`/`entered_at` this many whole days back, keeping `date_kind='live'`. */
  carriedOverDaysBack?: number;
  preorderDaysAhead?: number;
};

const RECIPES: Record<CardState, Recipe> = {
  // A promise comfortably beyond the due-soon lead (10 min) so the card is
  // plainly on-time rather than one tick away from due-soon.
  "on-time": { dueIn: 45 },
  // Inside the lead, outside the grace — the brief's own worked example uses
  // nine minutes for exactly this reason.
  "due-soon": { dueIn: 9 },
  // Past the promise AND past the grace (5 min).
  late: { dueIn: -20 },
  // Declared, not computed: the original promise has passed, the revised one
  // has not (brief, "Late vs delayed").
  delayed: { dueIn: -10, delayed: true },
  held: { dueIn: 45, status: "on-hold", stamp: ["held_at"] },
  // `awaiting-customer` is what "ready" looks like on today's schema, and the
  // brief keeps that status precisely so the website and history still work:
  // choosing it on the board runs the `ready` transition, and PATCH writing it
  // stamps `ready_at` (brief, "Decisions locked" → Ready). Until the column
  // exists the status is all there is, so the card derives as on-time and the
  // caveat says why.
  ready: { dueIn: 45, status: "awaiting-customer", stamp: ["ready_at"], needsColumns: ["ready_at"] },
  "customer-waiting": {
    dueIn: 20,
    stamp: ["customer_arrived_at"],
    needsColumns: ["customer_arrived_at"],
  },
  completed: { dueIn: 45, status: "completed" },
  // Two whole days back, not one: a single day would land within the same
  // trading day at some hours, and "carried over" is a trading-day comparison.
  // `date_kind` deliberately stays 'live' — a backdated order is dated in the
  // past on purpose and never counts as carried over (opsState.ts:180).
  "carried-over": { dueIn: null, carriedOverDaysBack: 2 },
  // `dueIn: null` here means "no offset from now", not "no promise" — a
  // pre-order needs one on its OWN day, which `orderInState` sends as
  // `dueTime: "12:00"` (see `preorderDueTime` above) rather than a `dueIn`
  // offset, since "now" is not the day the promise is for (N3a: the create
  // route 400s a pre-order with no due time at all).
  scheduled: { dueIn: null, preorderDaysAhead: 3 },
};

async function applyState(
  api: APIRequestContext,
  db: OpsDb,
  args: {
    orderId: string;
    orgId: string;
    state: CardState;
    recipe: Recipe;
    now: Date;
    dueAt: Date | null;
    timezone: string;
    minutesAgo?: number;
    assignedTo?: string;
    caveats: string[];
  },
): Promise<void> {
  const { orderId, orgId, recipe, now, dueAt, timezone, minutesAgo, assignedTo, caveats } = args;
  const present = await orderColumns(db);

  for (const column of recipe.needsColumns ?? []) {
    if (!present.has(column)) {
      caveats.push(
        `orders.${column} does not exist yet (migration 065, package N2) — the closest ` +
          `state today was built instead`,
      );
    }
  }

  // 1. The promise. `POST /api/orders` (N3a) already resolves a positive
  //    `dueInMinutes` — and a pre-order's `dueTime` — into `eta_given` at
  //    creation, so this only ever has work to do for a promise already in
  //    the past (late/delayed's negative `dueIn`), which creation deliberately
  //    never sends. `set_due` (N3b, `POST /api/orders/:id/transition`) is the
  //    real writer now; it 409s ("a due time is already set") on any order
  //    creation already covered, in which case there is genuinely nothing left
  //    to do here.
  if (dueAt) {
    const etaRows = await queryRows<{ eta_given: unknown }>(
      db,
      sql`SELECT eta_given FROM orders WHERE id = ${orderId} AND org_id = ${orgId}`,
    );
    const currentEta = etaRows[0]?.eta_given ?? null;
    if (!currentEta) {
      const dueTime = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(dueAt);
      const viaApi = await api.post(`/api/orders/${orderId}/transition`, {
        data: { action: "set_due", dueTime },
      });
      if (!viaApi.ok()) {
        await db.execute(
          sql`UPDATE orders SET eta_given = ${dueAt}, original_eta = COALESCE(original_eta, ${dueAt}) WHERE id = ${orderId} AND org_id = ${orgId}`,
        );
        caveats.push(
          `POST /api/orders/:id/transition {action:"set_due"} did not accept dueTime (${viaApi.status()}) ` +
            `— wrote eta_given directly instead.`,
        );
      }
    }
  }

  // 2. Delayed is a declaration: the first promise stands as `original_eta`,
  //    `revised_eta` is the new one, and `delay_flag` says a person moved it.
  if (recipe.delayed) {
    const revisedEta = new Date(now.getTime() + 30 * 60_000);
    const viaApi = await api.patch(`/api/orders/${orderId}/operations`, {
      data: {
        delayFlag: true,
        // One of shared/delayCauses.ts's five — the endpoint validates against
        // that exact list.
        delayCause: "Prep error",
        delayReason: `${OPS_PREFIX} fixture delay`,
        revisedEta: revisedEta.toISOString(),
      },
    });
    if (!viaApi.ok()) {
      await db.execute(
        sql`UPDATE orders SET delay_flag = true, revised_eta = ${revisedEta} WHERE id = ${orderId} AND org_id = ${orgId}`,
      );
      caveats.push(
        `PATCH …/operations did not accept the delay (${viaApi.status()}) — wrote delay_flag and revised_eta directly`,
      );
    }
  }

  // 3. Stage timestamps. No endpoint writes these until N3b, and the columns
  //    themselves arrive with N2 — hence the presence check rather than a
  //    try/catch on a failing UPDATE, which would leave the order in an
  //    unknown state.
  for (const column of recipe.stamp ?? []) {
    if (!present.has(column)) continue;
    await db.execute(
      sql`UPDATE orders SET ${sql.raw(column)} = COALESCE(${sql.raw(column)}, ${now}) WHERE id = ${orderId} AND org_id = ${orgId}`,
    );
  }

  // 4. Status, through the real PATCH so completion runs the settlement
  //    transaction rather than a fabricated `settled_at`.
  if (recipe.status && recipe.status !== "pending") {
    const res = await api.patch(`/api/orders/${orderId}`, { data: { status: recipe.status } });
    if (!res.ok()) {
      throw new Error(
        `PATCH /api/orders/${orderId} {status:"${recipe.status}"} failed: ${res.status()} ${await res.text()}`,
      );
    }
  }

  // 5. Received time. `entered_at` is what the card counts from
  //    (`receivedAt = entered_at ?? created_at`), and `created_at` is the day
  //    the sale is FOR — so a carried-over order needs BOTH moved while
  //    `date_kind` stays 'live', which is the one thing no endpoint can do.
  const backMinutes =
    minutesAgo ?? (recipe.carriedOverDaysBack ? recipe.carriedOverDaysBack * 24 * 60 : undefined);
  if (backMinutes !== undefined) {
    const receivedAt = new Date(now.getTime() - backMinutes * 60_000);
    if (recipe.carriedOverDaysBack) {
      await db.execute(
        sql`UPDATE orders SET entered_at = ${receivedAt}, created_at = ${receivedAt} WHERE id = ${orderId} AND org_id = ${orgId}`,
      );
    } else {
      await db.execute(
        sql`UPDATE orders SET entered_at = ${receivedAt} WHERE id = ${orderId} AND org_id = ${orgId}`,
      );
    }
  }

  // 6. Who is dealing with it.
  if (assignedTo) {
    if (present.has("assigned_user_id")) {
      await db.execute(
        sql`UPDATE orders SET assigned_user_id = ${assignedTo}, assigned_at = COALESCE(assigned_at, ${now}) WHERE id = ${orderId} AND org_id = ${orgId}`,
      );
    } else {
      caveats.push(
        `orders.assigned_user_id does not exist yet (migration 065, package N2) — the order is unassigned; ` +
          `TODO(N3b): claim it through POST /api/orders/:id/transition {action:"claim"} as that user instead`,
      );
    }
  }
}

/**
 * The row, read back in N0's `OpsOrderInput` shape.
 *
 * Raw SQL rather than drizzle because the stage columns are not in
 * `shared/schema.ts` yet: selecting only the columns that exist means this
 * works before and after migration 065 without a second code path.
 */
export async function readOpsOrder(
  db: OpsDb,
  orgId: string,
  orderId: string,
): Promise<{ input: OpsOrderInput; assignedUserId: string | null }> {
  const present = await orderColumns(db);
  const optional = STAGE_COLUMNS.filter((c) => present.has(c));
  const columns = [
    "status",
    "fulfilment_method",
    "date_kind",
    "created_at",
    "entered_at",
    "eta_given",
    "revised_eta",
    "delay_flag",
    "settled_at",
    ...optional,
  ];
  const result = (await db.execute(
    sql`SELECT ${sql.raw(columns.join(", "))} FROM orders WHERE id = ${orderId} AND org_id = ${orgId}`,
  )) as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const row = rows[0];
  if (!row) throw new Error(`Order ${orderId} not found in org ${orgId}`);

  const at = (key: string): string | Date | null => (row[key] as string | Date | null) ?? null;
  return {
    assignedUserId: (row.assigned_user_id as string | null) ?? null,
    input: {
      status: String(row.status ?? "pending"),
      fulfilmentMethod: (row.fulfilment_method as FulfilmentMethod) ?? "collection",
      dateKind: (row.date_kind as OpsOrderInput["dateKind"]) ?? "live",
      createdAt: at("created_at") ?? new Date(),
      enteredAt: at("entered_at"),
      etaGiven: at("eta_given"),
      revisedEta: at("revised_eta"),
      delayFlag: row.delay_flag === true,
      heldAt: at("held_at"),
      readyAt: at("ready_at"),
      customerArrivedAt: at("customer_arrived_at"),
      outForDeliveryAt: at("out_for_delivery_at"),
      settledAt: at("settled_at"),
    },
  };
}

// -------------------------------------------------------------------- product

type OpsProduct = { id: string; unitPrice: number };

const productByLocation = new Map<string, Promise<OpsProduct>>();

/**
 * A product this suite owns, created once per location per worker.
 *
 * Selling a seeded product would couple these fixtures to the money journeys'
 * exact-stock assertions — the mistake `money.spec.ts` documents at its
 * `sellableProduct` helper. Stock is set high enough that no realistic run
 * exhausts it; a run that does should create a fresh location rather than
 * stretch this one.
 */
async function opsProduct(api: APIRequestContext, locationId: string): Promise<OpsProduct> {
  const existing = productByLocation.get(locationId);
  if (existing) return existing;

  const promise = (async () => {
    const suffix = uniqueSuffix();
    const unitPrice = 10;
    const created = await okJson<{ id: string }>(
      await api.post("/api/products", {
        data: {
          name: `${OPS_PREFIX} Board Item ${suffix}`,
          productCode: `OPS-${suffix}`.slice(0, 40),
          costPrice: 4,
          // The engine reads `salePrice`; sending only `defaultSalePrice`
          // creates the product at zero (money.spec.ts documents this).
          salePrice: unitPrice,
          defaultSalePrice: unitPrice,
          stock: 0,
          stockLimit: 5000,
        },
      }),
    );
    const seeded = await api.patch(`/api/inventory/${created.id}`, {
      headers: { "x-location-id": locationId },
      data: { adjustment: 2000, type: "set" },
    });
    if (!seeded.ok()) {
      throw new Error(
        `Could not seed stock for the ops fixture product at ${locationId}: ${seeded.status()} ${await seeded.text()}`,
      );
    }
    return { id: created.id, unitPrice };
  })();

  productByLocation.set(locationId, promise);
  return promise;
}

// ----------------------------------------------------------------- date helpers

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60_000);
}

/**
 * The calendar date an instant falls on in a given zone, as `YYYY-MM-DD`.
 *
 * `POST /api/orders` takes a plain date for `orderDate` and classifies it
 * against today IN THE ORG'S ZONE (shared/orders/orderDate.ts), so the date
 * has to be formed in that zone too — `toISOString().slice(0, 10)` is UTC and
 * is a day out for part of every day. This is formatting, not timezone maths:
 * the trading-day rules themselves stay in `shared/time/tradingDay.ts`, which
 * is already tested (see docs/testing/FAKE_TIME.md).
 */
function isoDateIn(timeZone: string, instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}
