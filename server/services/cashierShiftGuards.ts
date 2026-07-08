export type SubmittedCashierShift = {
  id: string;
  cashierId: string;
  status: string;
};

export function canAttachSubmittedCashierShift(
  shift: SubmittedCashierShift | null | undefined,
  submittedCashierId: string,
): shift is SubmittedCashierShift {
  return !!shift && shift.cashierId === submittedCashierId && shift.status === "open";
}
