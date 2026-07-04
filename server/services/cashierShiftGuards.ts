import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "@shared/schema";

const TOKEN_VERSION = 1;

export type CashierShiftReplayClaims = {
  orgId: string;
  cashierId: string;
  shiftId: string;
  openedAt: string;
};

export type CashierShiftActor = {
  role?: string | null;
  userId?: string | null;
};

const privilegedRoles = new Set<Role>(["SUPER_ADMIN", "ADMIN", "MANAGER"]);

function replaySecret(): string {
  return (
    process.env.CASHIER_SHIFT_REPLAY_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    "dev-cashier-shift-replay-secret-change-me"
  );
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function signCashierShiftReplayToken(
  claims: CashierShiftReplayClaims,
  secret = replaySecret(),
): string {
  const payload = encode({ v: TOKEN_VERSION, ...claims });
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyCashierShiftReplayToken(
  token: string | null | undefined,
  expected: CashierShiftReplayClaims,
  secret = replaySecret(),
): boolean {
  if (!token) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return false;
  if (!safeEqual(signature, sign(payload, secret))) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<
      CashierShiftReplayClaims & { v: number }
    >;
    return (
      parsed.v === TOKEN_VERSION &&
      parsed.orgId === expected.orgId &&
      parsed.cashierId === expected.cashierId &&
      parsed.shiftId === expected.shiftId &&
      parsed.openedAt === expected.openedAt
    );
  } catch {
    return false;
  }
}

export function canUseCashierShift(
  actor: CashierShiftActor,
  shift: { openedByUserId: string },
): boolean {
  if (actor.role && privilegedRoles.has(actor.role as Role)) return true;
  return !!actor.userId && shift.openedByUserId === actor.userId;
}

export function canCloseCashierShift(
  actor: CashierShiftActor,
  shift: { openedByUserId: string },
): boolean {
  return canUseCashierShift(actor, shift);
}
