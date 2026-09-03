/**
 * An order can be dated for a day other than the one it is keyed in on: a
 * missed day's sales entered afterwards, or a pre-order taken ahead of time.
 *
 * Three things have to hold, and each is covered here:
 *
 *   1. A date outside the window (7 days back, 14 ahead) is refused before the
 *      order exists. Clamping it would put the sale on a day nobody chose.
 *   2. A dated order is stamped with the day it is FOR in `created_at`, which
 *      is the column every report reads, and keeps `date_kind` so it is never
 *      mistaken for a live sale afterwards. A live sale writes nothing extra.
 *   3. A backdated sale joins the shift of the day it was sold on — not today's
 *      — and no drawer, since the drawer it belonged to has been counted.
 */
import type { RequestHandler } from "express";
import { describe, expect, it, vi, beforeEach } from "vitest";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const ORDER_ID = "00000000-0000-4000-8000-0000000000aa";
const TODAY_SHIFT = "00000000-0000-4000-8000-00000000001d";
const OLD_SHIFT = "00000000-0000-4000-8000-00000000010d";

/** Every `.set()` patch the transaction wrote, in order. */
let patches: Record<string, unknown>[] = [];
let createdRow: Record<string, unknown>;

const placeOrderMock = vi.hoisted(() => vi.fn());
const resolveShiftMock = vi.hoisted(() => vi.fn());
const settleMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const refreshMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../auth", () => {
  const pass = ((_req, _res, next) => next()) as RequestHandler;
  return {
    isAuthenticated: pass,
    isOwner: pass,
    requireOrgContext: pass,
    requireOrgScope: pass,
    requireSuperAdminMfa: pass,
    requireRole: () => pass,
  };
});

vi.mock("../eventBus", () => ({
  publishEvent: vi.fn().mockResolvedValue("evt-1"),
  publishEventTx: vi.fn().mockResolvedValue("evt-1"),
}));

vi.mock("../../apps/server/src/db", () => ({
  withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      update: () => ({
        set: (patch: Record<string, unknown>) => {
          patches.push(patch);
          return { where: async () => undefined };
        },
      }),
      select: () => ({
        from: (table: { __name?: string }) => ({
          where: async () => (table.__name === "orders" ? [createdRow] : []),
        }),
      }),
      insert: () => ({ values: async () => undefined }),
    };
    return fn(tx);
  },
}));

vi.mock("../../apps/server/src/db/schema", () => ({
  orders: { __name: "orders", id: "id" },
  order_items: { __name: "order_items", order_id: "order_id" },
}));

vi.mock("../../apps/server/src/engine.wiring", () => ({
  engine: { placeOrder: placeOrderMock },
}));

vi.mock("../services/orgTaxRate", () => ({
  getOrgTaxRatePercent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db", () => ({ db: {}, pool: {} }));

vi.mock("../middleware/requireOpenShift", () => ({
  requireOpenShift: ((_req: any, _res: any, next: any) => next()) as RequestHandler,
}));
vi.mock("../middleware/requireActiveCashierShift", () => ({
  requireActiveCashierShift: ((_req: any, _res: any, next: any) => next()) as RequestHandler,
  attachActiveCashierShift: ((_req: any, _res: any, next: any) => next()) as RequestHandler,
}));
vi.mock("../services/cashierShiftEngine", () => ({
  refreshClosedCashierShiftSummary: refreshMock,
  closeCashierShift: vi.fn(),
}));
// The org's clock. Everything else in orderDating.ts is exercised for real.
vi.mock("../services/tradingDayShift", () => ({
  orgTimeZone: vi.fn().mockResolvedValue("Europe/London"),
  resolveShiftForToday: resolveShiftMock,
}));
vi.mock("../services/orderDating", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/orderDating")>();
  return { ...actual, settleBackdatedShift: settleMock };
});
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../adminAudit", () => ({ recordAdminAudit: vi.fn().mockResolvedValue(undefined) }));

const { registerOrderRoutes } = await import("../routes/orders");

type Handler = (req: any, res: any) => Promise<void> | void;

function postHandler(): Handler {
  const chain: any[] = [];
  const app: any = {
    get: () => {},
    post: (path: string, ...rest: any[]) => {
      if (path === "/api/orders") chain.push(...rest);
    },
    put: () => {},
    patch: () => {},
    delete: () => {},
  };
  registerOrderRoutes(app, []);
  return chain[chain.length - 1];
}

async function placeOrder(body: Record<string, unknown>) {
  const handler = postHandler();
  const req: any = {
    body,
    orgContext: { orgId: ORG_ID, locationId: null, role: "CASHIER" },
    user: { id: "user_1" },
    shift: { id: "till-shift-today" },
    cashierShift: { cashierId: null, cashierShiftId: TODAY_SHIFT },
  };
  let status = 200;
  let payload: any;
  const res: any = {
    status(code: number) {
      status = code;
      return this;
    },
    json: (p: unknown) => {
      payload = p;
      return p;
    },
  };
  await handler(req, res);
  return { status, payload, req };
}

const lines = [{ productId: "p1", quantity: 1, unitPrice: 20 }];

/** What the local calendar says today is; the mocked org zone is London. */
function londonToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
}

function daysFromToday(days: number): string {
  const [y, m, d] = londonToday().split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return moved.toISOString().slice(0, 10);
}

beforeEach(() => {
  patches = [];
  createdRow = {
    id: ORDER_ID,
    status: "pending",
    total: "24.00",
    payment_method: "cash",
    created_at: new Date(),
    date_kind: "live",
  };
  placeOrderMock.mockReset().mockResolvedValue({ orderId: ORDER_ID });
  resolveShiftMock.mockReset();
  settleMock.mockClear();
  refreshMock.mockClear();
});

describe("dating an order", () => {
  it("refuses a date more than 7 days back before the order exists", async () => {
    const { status, payload } = await placeOrder({
      lines,
      paymentMethod: "cash",
      orderDate: daysFromToday(-8),
    });

    expect(status).toBe(400);
    expect(payload.code).toBe("ORDER_DATE_OUT_OF_RANGE");
    expect(placeOrderMock).not.toHaveBeenCalled();
  });

  it("refuses a pre-order more than 14 days ahead", async () => {
    const { status, payload } = await placeOrder({
      lines,
      paymentMethod: "cash",
      orderDate: daysFromToday(15),
    });

    expect(status).toBe(400);
    expect(payload.code).toBe("ORDER_DATE_OUT_OF_RANGE");
    expect(placeOrderMock).not.toHaveBeenCalled();
  });

  it("refuses a date that is not a date", async () => {
    const { status, payload } = await placeOrder({
      lines,
      paymentMethod: "cash",
      orderDate: "last tuesday",
    });

    expect(status).toBe(400);
    expect(payload.code).toBe("ORDER_DATE_INVALID");
  });

  it("dates a live sale by the server, touching nothing", async () => {
    const { status, req } = await placeOrder({ lines, paymentMethod: "cash" });

    expect(status).toBe(201);
    expect(patches.some((p) => "date_kind" in p)).toBe(false);
    // Today's shift and today's drawer, untouched.
    expect(req.cashierShift.cashierShiftId).toBe(TODAY_SHIFT);
    expect(patches.some((p) => p.shift_id === "till-shift-today")).toBe(true);
    expect(resolveShiftMock).not.toHaveBeenCalled();
    expect(settleMock).not.toHaveBeenCalled();
  });

  it("treats today's own date as live", async () => {
    const { status } = await placeOrder({ lines, paymentMethod: "cash", orderDate: londonToday() });

    expect(status).toBe(201);
    expect(patches.some((p) => "date_kind" in p)).toBe(false);
  });

  it("stamps a backdated sale on the day it is for, in that day's shift, in no drawer", async () => {
    const soldOn = daysFromToday(-2);
    resolveShiftMock.mockResolvedValue({
      id: OLD_SHIFT,
      cashierId: null,
      status: "closed",
      tradingDay: soldOn,
    });

    const { status, req } = await placeOrder({ lines, paymentMethod: "cash", orderDate: soldOn });

    expect(status).toBe(201);

    const dated = patches.find((p) => "date_kind" in p)!;
    expect(dated.date_kind).toBe("backdated");
    expect((dated.created_at as Date).toISOString().slice(0, 10)).toBe(soldOn);
    expect(dated.entered_at).toBeInstanceOf(Date);

    // The sold-on day's shift was resolved for the instant the order is
    // stamped with, and replaced today's on the request.
    expect(resolveShiftMock).toHaveBeenCalledWith(ORG_ID, "user_1", dated.created_at);
    expect(req.cashierShift.cashierShiftId).toBe(OLD_SHIFT);
    expect(patches.some((p) => p.cashier_shift_id === OLD_SHIFT)).toBe(true);
    expect(patches.some((p) => p.cashier_shift_id === TODAY_SHIFT)).toBe(false);
    // No drawer: today's has not seen this money, and that day's is counted.
    expect(patches.some((p) => "shift_id" in p)).toBe(false);

    // And the old day's summary is brought up to date once the order is in.
    expect(settleMock).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ id: OLD_SHIFT }));
  });

  it("records a pre-order against its day but keeps today's shift and drawer", async () => {
    const dueOn = daysFromToday(10);

    const { status, req } = await placeOrder({ lines, paymentMethod: "cash", orderDate: dueOn });

    expect(status).toBe(201);
    const dated = patches.find((p) => "date_kind" in p)!;
    expect(dated.date_kind).toBe("preorder");
    expect((dated.created_at as Date).toISOString().slice(0, 10)).toBe(dueOn);

    // Money taken today goes in today's drawer and shift.
    expect(resolveShiftMock).not.toHaveBeenCalled();
    expect(req.cashierShift.cashierShiftId).toBe(TODAY_SHIFT);
    expect(patches.some((p) => p.shift_id === "till-shift-today")).toBe(true);
    expect(settleMock).not.toHaveBeenCalled();
  });

  it("the dating stamp comes after the shift stamp, so a dated order wins over a replay time", async () => {
    const soldOn = daysFromToday(-1);
    resolveShiftMock.mockResolvedValue({ id: OLD_SHIFT, cashierId: null, status: "open", tradingDay: soldOn });

    await placeOrder({ lines, paymentMethod: "cash", orderDate: soldOn });

    const shiftIdx = patches.findIndex((p) => "cashier_shift_id" in p);
    const dateIdx = patches.findIndex((p) => "date_kind" in p);
    expect(shiftIdx).toBeGreaterThanOrEqual(0);
    expect(dateIdx).toBeGreaterThan(shiftIdx);
  });
});
