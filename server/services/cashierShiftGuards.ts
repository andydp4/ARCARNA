import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";

export type CashierShiftReplayClaims = {
  orgId: string;
  cashierId: string;
  cashierShiftId: string;
  openedAt: Date | string;
};

function replaySecret(explicitSecret?: string): string {
  const secret = explicitSecret ?? process.env.CASHIER_SHIFT_REPLAY_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET must be set to sign cashier shift replay tokens");
  }
  return secret;
}

function openedAtValue(openedAt: Date | string): string {
  return openedAt instanceof Date ? openedAt.toISOString() : new Date(openedAt).toISOString();
}

function replayPayload(claims: CashierShiftReplayClaims): string {
  return [
    TOKEN_VERSION,
    claims.orgId,
    claims.cashierId,
    claims.cashierShiftId,
    openedAtValue(claims.openedAt),
  ].join("\n");
}

export function signCashierShiftReplayToken(
  claims: CashierShiftReplayClaims,
  explicitSecret?: string,
): string {
  const signature = createHmac("sha256", replaySecret(explicitSecret))
    .update(replayPayload(claims))
    .digest("hex");
  return `${TOKEN_VERSION}.${signature}`;
}

export function verifyCashierShiftReplayToken(
  claims: CashierShiftReplayClaims,
  token: string | null | undefined,
  explicitSecret?: string,
): boolean {
  if (!token?.startsWith(`${TOKEN_VERSION}.`)) return false;
  const expected = signCashierShiftReplayToken(claims, explicitSecret);
  const actualBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
