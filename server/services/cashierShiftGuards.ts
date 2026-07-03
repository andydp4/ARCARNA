import type { CashierShift } from "@shared/schema";

export function isSubmittedCashierShiftUsable(
  shift: { cashierId: string; status: string } | null | undefined,
  cashierId: string,
): boolean {
  return !!shift && shift.cashierId === cashierId && shift.status === "open";
}

export function canActorCloseCashierShift(
  actorRole: string,
  actorUserId: string | null | undefined,
  shift: Pick<CashierShift, "openedByUserId">,
): boolean {
  return actorRole !== "CASHIER" || (!!actorUserId && shift.openedByUserId === actorUserId);
}

export function validateShiftCommissionPayment(input: {
  requestedCashierId: string;
  summaryCashierId: string;
  commissionAmount: number;
  alreadyPaid: number;
  amountPaid: number;
}): { ok: true } | { ok: false; status: number; message: string; code: string } {
  if (input.summaryCashierId !== input.requestedCashierId) {
    return {
      ok: false,
      status: 400,
      message: "Commission shift does not belong to the selected cashier",
      code: "SHIFT_CASHIER_MISMATCH",
    };
  }

  const unpaid = Math.max(0, Math.round((input.commissionAmount - input.alreadyPaid) * 100) / 100);
  if (input.amountPaid > unpaid + 0.005) {
    return {
      ok: false,
      status: 409,
      message: "Commission payment exceeds the unpaid amount for this shift",
      code: "COMMISSION_OVERPAID",
    };
  }

  return { ok: true };
}
