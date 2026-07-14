export type CashierShiftSnapshotBody = {
  cashierId?: unknown;
  cashierShiftId?: unknown;
  _offlineOrderReplay?: unknown;
  _offlineQueuedAt?: unknown;
};

export type CashierShiftSnapshotRow = {
  id: string;
  cashierId: string;
  openedByUserId: string;
  openedAt: Date | string | number;
  closedAt: Date | string | number | null;
  status: string;
};

export type TrustedCashierShiftSnapshot =
  | { trusted: true; cashierId: string; cashierShiftId: string }
  | { trusted: false; reason: string };

function toTime(value: Date | string | number | null | undefined): number | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function resolveTrustedOfflineCashierShiftSnapshot(
  body: CashierShiftSnapshotBody,
  shift: CashierShiftSnapshotRow | null | undefined,
  userId: string | null | undefined,
  now: Date = new Date(),
): TrustedCashierShiftSnapshot {
  const cashierId = typeof body.cashierId === "string" ? body.cashierId : null;
  const cashierShiftId = typeof body.cashierShiftId === "string" ? body.cashierShiftId : null;
  if (!cashierId || !cashierShiftId) {
    return { trusted: false, reason: "missing_snapshot" };
  }

  if (body._offlineOrderReplay !== true) {
    return { trusted: false, reason: "not_offline_replay" };
  }

  if (!shift || shift.id !== cashierShiftId || shift.cashierId !== cashierId) {
    return { trusted: false, reason: "shift_mismatch" };
  }

  if (!userId || shift.openedByUserId !== userId) {
    return { trusted: false, reason: "opened_by_mismatch" };
  }

  const queuedAt = toTime(body._offlineQueuedAt as Date | string | number | null | undefined);
  const openedAt = toTime(shift.openedAt);
  const closedAt = toTime(shift.closedAt);
  const nowTime = now.getTime();
  if (queuedAt == null || openedAt == null || !Number.isFinite(nowTime)) {
    return { trusted: false, reason: "invalid_time" };
  }

  if (queuedAt < openedAt || queuedAt > (closedAt ?? nowTime)) {
    return { trusted: false, reason: "outside_shift_window" };
  }

  return { trusted: true, cashierId, cashierShiftId };
}
