/** Worker-level regressions for ARC-BUG-23 and removed lines (#224).
 * Stateful stock/ledger doubles exercise the real event handler without a DB.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { inventoryMovements, orders, products, processedEvents } from "@shared/schema";
import type { EventEnvelope } from "@shared/schema";
import { InventoryWorker } from "../workers/inventoryWorker";

const state = vi.hoisted(() => ({
  stock: new Map<string, number>(),
  movements: [] as Array<Record<string, any>>,
  claims: new Set<string>(),
  nextEvent: 0,
}));
const ORG = "11111111-1111-4111-8111-111111111111";
const LOCATION = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const A = "44444444-4444-4444-8444-444444444444";
const B = "55555555-5555-4555-8555-555555555555";
const catalogue = [
  { id: A, productId: "SKU-A", name: "A", stock: 0, stockLimit: 10 },
  { id: B, productId: "SKU-B", name: "B", stock: 0, stockLimit: 10 },
];

// Evaluate the actual Drizzle predicates used by the worker, so order/org/
// location scoping is tested as well as arithmetic. No SQL or real DB is used.
function matching(rows: Array<Record<string, any>>, predicate: any) {
  const { sql, params } = new PgDialect().sqlToQuery(predicate);
  const columns = [...sql.matchAll(/"\w+"\."(\w+)" = \$\d+/g)].map((m) => m[1]);
  expect(columns).toHaveLength(params.length);
  const keys: Record<string, string> = {
    id: "id", product_id: "productId", correlation_id: "correlationId",
    org_id: "orgId", location_id: "locationId", event_id: "eventId",
    worker_name: "workerName",
  };
  return rows.filter((row) => columns.every((column, i) => row[keys[column]] === params[i]));
}

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (predicate: unknown) => {
          const rows = table === orders ? [{ id: ORDER, orgId: ORG, locationId: LOCATION }]
            : table === products ? catalogue
            : table === inventoryMovements ? state.movements
            : [];
          const selected = matching(rows, predicate);
          return Object.assign(Promise.resolve(selected), { limit: async (n: number) => selected.slice(0, n) });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (row: { eventId: string }) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            expect(table).toBe(processedEvents);
            if (state.claims.has(row.eventId)) return [];
            state.claims.add(row.eventId);
            return [{ eventId: row.eventId }];
          },
        }),
      }),
    }),
    delete: () => ({ where: async () => undefined }),
  },
}));

vi.mock("../services/productLocationStock", () => ({
  resolveStockLocationId: async () => LOCATION,
  adjustProductLocationStock: async (args: any) => {
    const before = state.stock.get(args.productId)!;
    const after = before + args.delta;
    if (!args.allowNegative && after < 0) throw new Error("Insufficient stock");
    state.stock.set(args.productId, after);
    state.movements.push({
      ...args.movement, orgId: args.orgId, locationId: args.locationId,
      productId: args.productId, delta: args.delta, previousStock: before, newStock: after,
    });
    return { previousStock: before, newStock: after };
  },
}));

function event(eventType: "OrderCreated" | "OrderUpdated", lines: Array<[string, number]>, wrapped = false): EventEnvelope {
  const items = lines.map(([identifier, qty], i) => ({
    lineId: `line-${i}`, ...(identifier.startsWith("SKU") ? { sku: identifier } : { productId: identifier }),
    name: identifier, qty, unitPrice: 1,
  }));
  return {
    eventId: `event-${++state.nextEvent}`, eventType, correlationId: ORDER,
    occurredAt: new Date().toISOString(), source: "test", version: 1,
    actor: { type: "system", id: "test" },
    payload: wrapped ? { order: { orderId: ORDER, items } } : { orderId: ORDER, items },
  } as EventEnvelope;
}

beforeEach(() => {
  state.stock = new Map([[A, 100], [B, 100]]);
  state.movements = [];
  state.claims.clear();
  state.nextEvent = 0;
});

async function apply(worker: InventoryWorker, e: EventEnvelope) {
  expect((await worker.handle(e)).status).toBe("success");
}

function deltas(productId = A) {
  return state.movements.filter((m) => m.productId === productId && m.correlationId === ORDER
    && m.orgId === ORG && m.locationId === LOCATION).map((m) => m.delta);
}

describe("InventoryWorker OrderUpdated", () => {
  it.each([
    [10, 7, 5], [10, 13, 15], [10, 7, 12], [10, 10, 10],
  ])("reconciles %i → %i → %i to exactly the final quantity", async (initial, first, final) => {
    const worker = new InventoryWorker();
    await apply(worker, event("OrderCreated", [[A, initial]]));
    expect(state.stock.get(A)).toBe(100 - initial);
    await apply(worker, event("OrderUpdated", [[A, first]], true));
    expect(state.stock.get(A)).toBe(100 - first);
    const last = event("OrderUpdated", [[A, final]], true);
    await apply(worker, last);
    expect(state.stock.get(A)).toBe(100 - final);
    expect(deltas().reduce((sum, delta) => sum + delta, 0)).toBe(-final);
    const count = state.movements.length;
    await apply(worker, last);
    expect(state.stock.get(A)).toBe(100 - final);
    expect(state.movements).toHaveLength(count);
    if (initial === 10 && first === 7 && final === 5) expect(deltas()).toEqual([-10, 3, 2]);
  });

  it("returns a removed product after repeated edits, preserving the other product", async () => {
    const worker = new InventoryWorker();
    await apply(worker, event("OrderCreated", [[A, 10], [B, 2]]));
    await apply(worker, event("OrderUpdated", [[A, 7], [B, 2]]));
    await apply(worker, event("OrderUpdated", [[A, 5], [B, 2]]));
    await apply(worker, event("OrderUpdated", [[B, 2]]));
    expect(state.stock.get(A)).toBe(100);
    expect(state.stock.get(B)).toBe(98);
    expect(deltas()).toEqual([-10, 3, 2, 5]);
    expect(deltas(B)).toEqual([-2]);
    await apply(worker, event("OrderUpdated", [[A, 4], [B, 2]]));
    expect(state.stock.get(A)).toBe(96);
    expect(deltas()).toEqual([-10, 3, 2, 5, -4]);
  });

  it("restocks all lines in an empty update exactly once", async () => {
    const worker = new InventoryWorker();
    await apply(worker, event("OrderCreated", [[A, 10], [B, 2]]));
    const removed = event("OrderUpdated", []);
    await apply(worker, removed);
    await apply(worker, removed);
    expect([...state.stock.values()]).toEqual([100, 100]);
    expect(deltas()).toEqual([-10, 10]);
    expect(deltas(B)).toEqual([-2, 2]);
  });

  it("sums multiple lines and SKU/UUID aliases before reconciling a product", async () => {
    const worker = new InventoryWorker();
    await apply(worker, event("OrderCreated", [[A, 6], ["SKU-A", 4]]));
    await apply(worker, event("OrderUpdated", [[A, 3], ["SKU-A", 4]]));
    await apply(worker, event("OrderUpdated", [["SKU-A", 5]]));
    expect(state.stock.get(A)).toBe(95);
    expect(deltas()).toEqual([-6, -4, 3, 2]);
  });

  it("ignores another order, organisation or location's movement history", async () => {
    const worker = new InventoryWorker();
    await apply(worker, event("OrderCreated", [[A, 10]]));
    const own = state.movements[0];
    state.movements.push(
      { ...own, correlationId: "another-order", delta: -30 },
      { ...own, orgId: "another-org", delta: -40 },
      { ...own, locationId: "another-location", delta: -50 },
    );
    await apply(worker, event("OrderUpdated", [[A, 7]]));
    await apply(worker, event("OrderUpdated", [[A, 5]]));
    expect(state.stock.get(A)).toBe(95);
    expect(deltas()).toEqual([-10, 3, 2]);
  });
});
