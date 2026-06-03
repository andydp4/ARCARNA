export type GiftCardStatus = "active" | "redeemed" | "expired" | "void";

export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function canRedeemAmount(
  balance: number,
  amount: number,
  status: GiftCardStatus,
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: string } {
  if (status === "void") return { ok: false, reason: "Gift card has been voided" };
  if (status === "expired") return { ok: false, reason: "Gift card has expired" };
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "Gift card has expired" };
  if (amount <= 0) return { ok: false, reason: "Redeem amount must be positive" };
  if (amount > balance + 0.001) return { ok: false, reason: "Redeem amount exceeds gift card balance" };
  return { ok: true };
}

export function applyRedeem(balance: number, amount: number): { newBalance: number; status: GiftCardStatus } {
  const newBalance = roundMoney(balance - amount);
  if (newBalance < 0) throw new Error("Balance cannot go negative");
  return { newBalance, status: newBalance === 0 ? "redeemed" : "active" };
}

export function applyVoid(): { newBalance: number; status: GiftCardStatus } {
  return { newBalance: 0, status: "void" };
}

export function applyIssue(amount: number): { balance: number; status: GiftCardStatus } {
  if (amount <= 0) throw new Error("Issue amount must be positive");
  return { balance: roundMoney(amount), status: "active" };
}
