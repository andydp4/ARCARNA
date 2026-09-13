/**
 * `applyOpsBusEvent`'s "alert" case (Phase N, N5b gap fix — adversarial
 * review of PR #197, "alert rail, pulse, chime and announcer").
 *
 * Before this fix, `server/services/opsAlerts.ts` never called
 * `publishOpsEvent`, so nothing ever sent an `{ type: 'alert' }` opsBus
 * event and this case was a documented no-op. Now that the server side
 * pushes one, this file owns the CLIENT half: merging a pushed alert into
 * the board's own query-cache entry, exactly like the "order" case already
 * does, and — the one thing that makes "alert" different from every other
 * `OpsBusEvent` variant — filtering it by the signed-in user first.
 *
 * `opsBus` broadcasts to every tablet connected to an ORG's stream, but
 * `server/services/opsBoard.ts`'s own doc comment is explicit that the
 * board's `alerts` field is the signed-in USER's own unacked, unresolved
 * rows, not the whole org's. A naive merge would show Sam's personal alert
 * on Ana's tablet the moment it was pushed; these tests exist to catch
 * exactly that regression.
 */
import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  applyOpsBusEvent,
  OPS_BOARD_QUERY_KEY,
  type OpsBoardResponse,
  type OpsAlertPush,
} from "../useOpsBoard";

function emptyBoard(userId: string | null): OpsBoardResponse {
  return {
    serverNow: new Date().toISOString(),
    tradingDay: "2026-09-13",
    timezone: "Europe/London",
    settings: {
      prepSlaMinutes: 20,
      dueSoonLeadMinutes: 10,
      lateGraceMinutes: 5,
      deliveryLeadMinutes: 45,
      autoClaimOnCreate: true,
      alertOnSlaDue: false,
      keepScreenAwake: true,
      reconcilePollSeconds: 60,
    },
    me: { userId, station: null, onBreak: false },
    staff: [],
    orders: [],
    alerts: [],
    summary: {
      open: 0,
      collection: 0,
      delivery: 0,
      unassigned: 0,
      mine: 0,
      lateNow: 0,
      dueSoonNow: 0,
      readyWaiting: 0,
      carriedOver: 0,
      completedToday: 0,
    },
  };
}

function alertPush(overrides: Partial<OpsAlertPush> = {}): OpsAlertPush {
  return {
    id: "alert-1",
    orderId: "order-1",
    userId: "sam",
    kind: "assigned",
    station: "",
    dueAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeClient(board: OpsBoardResponse): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData(OPS_BOARD_QUERY_KEY, board);
  return queryClient;
}

describe("applyOpsBusEvent — alert case", () => {
  it("merges a pushed alert addressed to the signed-in user", () => {
    const queryClient = makeClient(emptyBoard("sam"));
    applyOpsBusEvent(queryClient, { type: "alert", alert: alertPush({ userId: "sam" }) });

    const board = queryClient.getQueryData<OpsBoardResponse>(OPS_BOARD_QUERY_KEY);
    expect(board?.alerts).toHaveLength(1);
    expect(board?.alerts[0].id).toBe("alert-1");
    // The wire-only `userId` field never leaks into the board's own
    // `OpsBoardAlert` shape — it is routing metadata, not board state.
    expect(board?.alerts[0]).not.toHaveProperty("userId");
  });

  it("NEVER merges an alert addressed to someone else — the privacy filter this fix exists to add", () => {
    const queryClient = makeClient(emptyBoard("ana"));
    applyOpsBusEvent(queryClient, { type: "alert", alert: alertPush({ id: "alert-2", userId: "sam" }) });

    const board = queryClient.getQueryData<OpsBoardResponse>(OPS_BOARD_QUERY_KEY);
    expect(board?.alerts).toHaveLength(0);
  });

  it("replaces an existing row by id rather than duplicating it, mirroring the 'order' case's upsert", () => {
    const initial = emptyBoard("sam");
    initial.alerts = [
      { id: "alert-1", orderId: "order-1", kind: "assigned", station: "", dueAt: null, createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    const queryClient = makeClient(initial);

    applyOpsBusEvent(queryClient, {
      type: "alert",
      alert: alertPush({ id: "alert-1", userId: "sam", createdAt: "2026-02-02T00:00:00.000Z" }),
    });

    const board = queryClient.getQueryData<OpsBoardResponse>(OPS_BOARD_QUERY_KEY);
    expect(board?.alerts).toHaveLength(1);
    expect(board?.alerts[0].createdAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("appends rather than replaces when the id is new", () => {
    const initial = emptyBoard("sam");
    initial.alerts = [
      { id: "alert-1", orderId: "order-1", kind: "assigned", station: "", dueAt: null, createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    const queryClient = makeClient(initial);

    applyOpsBusEvent(queryClient, { type: "alert", alert: alertPush({ id: "alert-2", userId: "sam" }) });

    const board = queryClient.getQueryData<OpsBoardResponse>(OPS_BOARD_QUERY_KEY);
    expect(board?.alerts.map((a) => a.id).sort()).toEqual(["alert-1", "alert-2"]);
  });

  it("is a no-op when there is no board cached yet", () => {
    const queryClient = new QueryClient();
    // No setQueryData call: the cache entry is genuinely absent, the same
    // state as an event arriving before the initial GET has resolved.
    applyOpsBusEvent(queryClient, { type: "alert", alert: alertPush() });
    expect(queryClient.getQueryData(OPS_BOARD_QUERY_KEY)).toBeUndefined();
  });
});
