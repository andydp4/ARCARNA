export type SubmittedCashierShift = {
  id: string;
  cashierId: string;
  status: string;
  openedAt: Date | string | null;
  closedAt: Date | string | null;
};

export type SubmittedCashierShiftPayload = {
  cashierId?: unknown;
  cashierShiftId?: unknown;
  _offlineOrderReplay?: unknown;
  _offlineQueuedAt?: unknown;
};

export type SubmittedCashierShiftDecision =
  | { accepted: true; cashierId: string; cashierShiftId: string; shouldTouchShift: boolean }
  | { accepted: false; reason: string };

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseOfflineQueuedAt(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

function isOfflineReplay(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function isQueuedDuringShift(shift: SubmittedCashierShift, queuedAt: Date): boolean {
  const openedAt = parseDate(shift.openedAt);
  if (!openedAt || queuedAt < openedAt) return false;
  const closedAt = parseDate(shift.closedAt);
  return !closedAt || queuedAt <= closedAt;
}

export function evaluateSubmittedCashierShift(
  payload: SubmittedCashierShiftPayload,
  shift: SubmittedCashierShift | null | undefined,
): SubmittedCashierShiftDecision {
  const cashierId = asNonEmptyString(payload.cashierId);
  const cashierShiftId = asNonEmptyString(payload.cashierShiftId);
  if (!cashierId || !cashierShiftId) {
    return { accepted: false, reason: "cashierId and cashierShiftId are required together" };
  }

  if (!shift || shift.id !== cashierShiftId || shift.cashierId !== cashierId) {
    return { accepted: false, reason: "cashier shift does not match the submitted cashier" };
  }

  if (shift.status === "open") {
    return { accepted: true, cashierId, cashierShiftId, shouldTouchShift: true };
  }

  const queuedAt = parseOfflineQueuedAt(payload._offlineQueuedAt);
  if (isOfflineReplay(payload._offlineOrderReplay) && queuedAt && isQueuedDuringShift(shift, queuedAt)) {
    return { accepted: true, cashierId, cashierShiftId, shouldTouchShift: false };
  }

  return { accepted: false, reason: "submitted cashier shift is not open for this sale" };
}
