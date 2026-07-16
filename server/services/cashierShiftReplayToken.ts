import { createHmac, timingSafeEqual } from "node:crypto";

export type CashierShiftReplayTokenPayload = {
  v: 1;
  orgId: string;
  cashierId: string;
  cashierShiftId: string;
  openedAt: string;
  openedByUserId: string;
};

export type CashierShiftReplayValidationInput = {
  orgId: string;
  userId: string;
  cashierId: string;
  cashierShiftId: string;
  token: string | undefined;
  queuedAt: unknown;
  shift: {
    orgId: string;
    cashierId: string;
    id: string;
    openedAt: Date;
    closedAt: Date | null;
    status: string;
    openedByUserId: string;
  };
};

export type CashierShiftReplayValidationResult =
  | { ok: true; queuedAt: Date; replayedToClosedShift: boolean }
  | { ok: false; reason: string };

function secret(): string {
  return process.env.CASHIER_SHIFT_REPLAY_SECRET || process.env.SESSION_SECRET || "";
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signPayload(encodedPayload: string, signingSecret = secret()): string {
  return createHmac("sha256", signingSecret).update(encodedPayload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createCashierShiftReplayToken(
  input: Omit<CashierShiftReplayTokenPayload, "v">,
  signingSecret = secret(),
): string {
  if (!signingSecret) throw new Error("SESSION_SECRET is required for cashier shift replay tokens");
  const payload = encodeJson({ v: 1, ...input });
  return `${payload}.${signPayload(payload, signingSecret)}`;
}

export function verifyCashierShiftReplayToken(
  token: string | undefined,
  signingSecret = secret(),
): CashierShiftReplayTokenPayload | null {
  if (!token || !signingSecret || token.length > 4096) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  if (!safeEqual(signature, signPayload(payload, signingSecret))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      parsed?.v !== 1 ||
      typeof parsed.orgId !== "string" ||
      typeof parsed.cashierId !== "string" ||
      typeof parsed.cashierShiftId !== "string" ||
      typeof parsed.openedAt !== "string" ||
      typeof parsed.openedByUserId !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseQueuedAt(value: unknown): Date | null {
  const date =
    typeof value === "number" || typeof value === "string" || value instanceof Date
      ? new Date(value)
      : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function validateCashierShiftReplay(
  input: CashierShiftReplayValidationInput,
): CashierShiftReplayValidationResult {
  const payload = verifyCashierShiftReplayToken(input.token);
  if (!payload) return { ok: false, reason: "missing_or_invalid_token" };
  if (
    payload.orgId !== input.orgId ||
    payload.cashierId !== input.cashierId ||
    payload.cashierShiftId !== input.cashierShiftId ||
    payload.openedByUserId !== input.userId
  ) {
    return { ok: false, reason: "token_context_mismatch" };
  }
  if (
    input.shift.orgId !== input.orgId ||
    input.shift.cashierId !== input.cashierId ||
    input.shift.id !== input.cashierShiftId ||
    input.shift.openedByUserId !== input.userId ||
    new Date(payload.openedAt).getTime() !== input.shift.openedAt.getTime()
  ) {
    return { ok: false, reason: "shift_context_mismatch" };
  }

  const queuedAt = parseQueuedAt(input.queuedAt);
  if (!queuedAt) return { ok: false, reason: "invalid_queued_at" };
  const shiftEnd = input.shift.closedAt ?? new Date();
  if (queuedAt < input.shift.openedAt || queuedAt > shiftEnd) {
    return { ok: false, reason: "queued_at_outside_shift" };
  }
  return {
    ok: true,
    queuedAt,
    replayedToClosedShift: input.shift.status !== "open",
  };
}

