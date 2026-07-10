type ActiveCashierShiftContext = {
  cashierId: string;
  cashierShiftId: string;
};

type SubmittedShiftRow = {
  id: string;
  cashierId: string;
  status: string;
} | null;

export type SubmittedCashierShiftValidation =
  | { kind: "missing" }
  | { kind: "valid"; context: ActiveCashierShiftContext }
  | { kind: "invalid"; status: number; code: string; message: string };

export function validateSubmittedCashierShift(
  submittedCashierId: string | undefined,
  submittedCashierShiftId: string | undefined,
  shift: SubmittedShiftRow,
): SubmittedCashierShiftValidation {
  if (!submittedCashierId || !submittedCashierShiftId) {
    return { kind: "missing" };
  }

  if (!shift || shift.cashierId !== submittedCashierId) {
    return {
      kind: "invalid",
      status: 409,
      code: "CASHIER_SHIFT_INVALID",
      message: "Submitted cashier shift does not match this cashier.",
    };
  }

  if (shift.status !== "open") {
    return {
      kind: "invalid",
      status: 409,
      code: "CASHIER_SHIFT_STALE",
      message: "Submitted cashier shift is no longer open. Start a new cashier shift before syncing this sale.",
    };
  }

  return {
    kind: "valid",
    context: { cashierId: submittedCashierId, cashierShiftId: submittedCashierShiftId },
  };
}
