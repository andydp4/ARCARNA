import { useMemo } from "react";

/**
 * The Operations Centre's per-person alerts — stub (Phase N, N4a).
 *
 * `ops_alerts` does not exist until migration 066 (N5a), and the sweep that
 * populates it (`server/services/opsAlerts.ts`) is N5a's too — this package
 * (N4a) is the board's own action wiring, not the alert engine, per the
 * brief's package order (`{ N4a ‖ N7 } → N4b → N6 → { N5a ‖ N7 } → N5b`).
 * `GET /api/orders/board` already parses an `alerts` array in its response
 * (`useOpsBoard.ts`'s `OpsBoardResponse`) and the stream already forwards a
 * `{ type: 'alert' }` delta into the board's query cache as a documented
 * no-op (`applyOpsBusEvent`, N3a) — both are always empty today because the
 * server always sends `alerts: []` until N5a. This hook is the seam N5b hangs
 * the pulse, the rail and the chime from without any card, lane or header
 * component in this package having to change its call shape twice: every
 * caller here already asks "is this order's alert mine" through
 * `isAlertForOrder`, which always answers `false` until N5a has rows and N5b
 * teaches this hook to read them.
 *
 * Deliberately not wired to `OpsBoardResponse.alerts` yet even though that
 * array exists: reading a field the server never populates would not make
 * this less of a stub, only a more confusing one — a reviewer diffing this
 * file against N5b's replacement should see one clear seam, not a
 * half-connected wire.
 */
export interface OpsAlertStub {
  id: string;
  orderId: string;
  kind: string;
}

export interface UseOpsAlertsResult {
  /** Always empty until N5a exists and N5b reads it. */
  alerts: OpsAlertStub[];
  /** Always false — no card pulses from this package. `data-alert` stays "false" everywhere. */
  isAlertForOrder(orderId: string): boolean;
}

const EMPTY: OpsAlertStub[] = [];

export function useOpsAlerts(): UseOpsAlertsResult {
  return useMemo<UseOpsAlertsResult>(
    () => ({
      alerts: EMPTY,
      isAlertForOrder: () => false,
    }),
    [],
  );
}
