import { OFFLINE_ORDER_QUEUED_AT, OFFLINE_ORDER_REPLAY_FLAG } from "@shared/cashierShiftReplay";

export { OFFLINE_ORDER_QUEUED_AT, OFFLINE_ORDER_REPLAY_FLAG };

export type CashierShiftForSubmission = {
  id: string;
  cashierId: string;
  status: string;
  openedAt: Date | string;
  closedAt: Date | string | null;
};

export type SubmittedCashierShiftPayload = {
  cashierId?: unknown;
  cashierShiftId?: unknown;
  [OFFLINE_ORDER_REPLAY_FLAG]?: unknown;
  [OFFLINE_ORDER_QUEUED_AT]?: unknown;
};

export type CashierShiftSubmissionResult =
  | { kind: "none" }
  | { kind: "accepted"; cashierId: string; cashierShiftId: string; replayedOfflineOrder: boolean }
  | { kind: "rejected"; status: number; code: string; message: string };

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateValue(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isOfflineReplayPayload(payload: SubmittedCashierShiftPayload): boolean {
  return payload[OFFLINE_ORDER_REPLAY_FLAG] === true;
}

export function resolveSubmittedCashierShift(
  payload: SubmittedCashierShiftPayload,
  shift: CashierShiftForSubmission | null,
  now = new Date(),
): CashierShiftSubmissionResult {
  const submittedCashierId = stringValue(payload.cashierId);
  const submittedShiftId = stringValue(payload.cashierShiftId);

  if (!submittedShiftId) return { kind: "none" };

  if (!submittedCashierId) {
    return {
      kind: "rejected",
      status: 409,
      code: "CASHIER_SHIFT_CONTEXT_INVALID",
      message: "Submitted cashier shift context must include both cashierId and cashierShiftId.",
    };
  }

  if (!shift || shift.id !== submittedShiftId || shift.cashierId !== submittedCashierId) {
    return {
      kind: "rejected",
      status: 409,
      code: "CASHIER_SHIFT_CONTEXT_INVALID",
      message: "Submitted cashier shift context does not match an org cashier shift.",
    };
  }

  if (shift.status === "open") {
    return {
      kind: "accepted",
      cashierId: submittedCashierId,
      cashierShiftId: submittedShiftId,
      replayedOfflineOrder: false,
    };
  }

  if (!isOfflineReplayPayload(payload)) {
    return {
      kind: "rejected",
      status: 409,
      code: "CASHIER_SHIFT_STALE",
      message: "Submitted cashier shift is no longer open.",
    };
  }

  const queuedAt = dateValue(payload[OFFLINE_ORDER_QUEUED_AT] as Date | string | null);
  const openedAt = dateValue(shift.openedAt);
  const closedAt = dateValue(shift.closedAt);

  if (!queuedAt || !openedAt || !closedAt || queuedAt < openedAt || queuedAt > closedAt || queuedAt > now) {
    return {
      kind: "rejected",
      status: 409,
      code: "CASHIER_SHIFT_REPLAY_INVALID",
      message: "Offline order replay timestamp does not fall within the submitted cashier shift.",
    };
  }

  return {
    kind: "accepted",
    cashierId: submittedCashierId,
    cashierShiftId: submittedShiftId,
    replayedOfflineOrder: true,
  };
}
