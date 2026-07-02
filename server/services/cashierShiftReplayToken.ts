import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";

type CashierShiftReplayPayload = {
  orgId: string;
  cashierId: string;
  shiftId: string;
  openedAt: string;
};

function signingSecret(): string {
  return process.env.SESSION_SECRET || "dev_cashier_shift_replay_secret_at_least_32_chars";
}

function encodeJson(value: CashierShiftReplayPayload): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", signingSecret()).update(`${TOKEN_VERSION}.${encodedPayload}`).digest("base64url");
}

export function createCashierShiftReplayToken(payload: CashierShiftReplayPayload): string {
  const encodedPayload = encodeJson(payload);
  return `${TOKEN_VERSION}.${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyCashierShiftReplayToken(token: string, expected: CashierShiftReplayPayload): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return false;

  const [, encodedPayload, signature] = parts;
  const expectedPayload = encodeJson(expected);
  if (encodedPayload !== expectedPayload) return false;

  const expectedSignature = sign(encodedPayload);
  const signatureBuffer = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");
  if (signatureBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(signatureBuffer, expectedBuffer);
}
