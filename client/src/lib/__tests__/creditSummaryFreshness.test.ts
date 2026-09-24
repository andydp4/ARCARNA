/**
 * "Already owes" must not show yesterday's figure (v1.2.1 credit, R3).
 *
 * A sale on credit, an edit, a refund or a status change can change what a
 * customer owes. The till's cached credit summary for that customer is
 * refreshed with the orders, so the next order for them shows the new total,
 * not the one from before the sale.
 */
import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

vi.mock("@/hooks/useOpsBoard", () => ({ OPS_BOARD_QUERY_KEY: ["/api/ops/board"] }));

const key = ["/api/customers", "c1", "credit-summary"] as const;

async function staleAfter(run: (qc: QueryClient) => Promise<unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(key, { customerId: "c1", owed: 42.5, tabs: 2, oldestGivenOn: "2026-09-01" });
  qc.setQueryData(["/api/customers", "c1"], { id: "c1" });
  await run(qc);
  return qc.getQueryState(key)?.isInvalidated;
}

describe("the till's credit summary is refreshed with the orders", () => {
  it("after a checkout", async () => {
    const { invalidateAfterPosCheckout } = await import("@/lib/query-invalidation");
    expect(await staleAfter((qc) => invalidateAfterPosCheckout(qc))).toBe(true);
  });

  it("after an order edit or delete", async () => {
    const { invalidateAfterOrderMutation } = await import("@/lib/query-invalidation");
    expect(await staleAfter((qc) => invalidateAfterOrderMutation(qc))).toBe(true);
  });

  it("after a status change (cancel, refund)", async () => {
    const { invalidateAfterOrderStatusChange } = await import("@/lib/query-invalidation");
    expect(await staleAfter((qc) => invalidateAfterOrderStatusChange(qc))).toBe(true);
  });
});
