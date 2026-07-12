export type SubmittedCashierShift = {
  id: string;
  cashierId: string;
  status: string;
  openedAt: Date;
  closedAt: Date | null;
};

export type SubmittedCashierShiftPayload = {
  cashierId?: unknown;
  cashierShiftId?: unknown;
  _offlineOrderReplay?: unknown;
  _offlineQueuedAt?: unknown;
};

function parseReplayDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function shouldTrustSubmittedCashierShift(
  payload: SubmittedCashierShiftPayload,
  shift: SubmittedCashierShift,
): boolean {
  if (payload.cashierId !== shift.cashierId || payload.cashierShiftId !== shift.id) return false;
  if (shift.status === "open") return true;
  if (payload._offlineOrderReplay !== true) return false;

  const queuedAt = parseReplayDate(payload._offlineQueuedAt);
  if (!queuedAt) return false;
  if (queuedAt < shift.openedAt) return false;
  if (!shift.closedAt) return false;
  return queuedAt <= shift.closedAt;
}
