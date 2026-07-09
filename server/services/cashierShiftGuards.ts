export type ActiveCashierShiftContext = {
  cashierId: string;
  cashierShiftId: string;
};

export type SubmittedCashierShift = {
  id: string;
  cashierId: string;
  status: string | null;
};

export type SubmittedCashierShiftValidation =
  | { status: "absent" }
  | { status: "trusted"; context: ActiveCashierShiftContext }
  | { status: "invalid"; message: string; code: "CASHIER_SHIFT_INVALID" };

export function validateSubmittedCashierShift(
  submitted: { cashierId?: string | null; cashierShiftId?: string | null },
  shift: SubmittedCashierShift | null,
): SubmittedCashierShiftValidation {
  const cashierId = submitted.cashierId?.trim();
  const cashierShiftId = submitted.cashierShiftId?.trim();

  if (!cashierShiftId) return { status: "absent" };
  if (!cashierId) {
    return {
      status: "invalid",
      code: "CASHIER_SHIFT_INVALID",
      message: "Submitted cashier shift context is incomplete.",
    };
  }

  if (!shift || shift.id !== cashierShiftId || shift.cashierId !== cashierId) {
    return {
      status: "invalid",
      code: "CASHIER_SHIFT_INVALID",
      message: "Submitted cashier shift is not valid for this organization.",
    };
  }

  if (shift.status !== "open") {
    return {
      status: "invalid",
      code: "CASHIER_SHIFT_INVALID",
      message: "The selected cashier shift is no longer open. Start a cashier shift before taking sales.",
    };
  }

  return {
    status: "trusted",
    context: { cashierId, cashierShiftId },
  };
}
