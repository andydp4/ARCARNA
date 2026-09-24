import crypto from "crypto";

/** The development-only key. Public (it is in the source), so never used in production. */
export const DEV_RECEIPT_SIGNING_KEY = "dev-receipt-signing-change-me";

/**
 * The key unsubscribe links are signed with (v1.2.1 SEC-UNSUBKEY).
 *
 * RECEIPT_SIGNING_SECRET when set. In production without it, a key derived
 * from SESSION_SECRET (required, 32+ characters, never public): the old
 * fallback was the public constant above, so anyone who knew a customer's id
 * could forge their unsubscribe link. Deriving rather than refusing to start
 * keeps a box that never set the variable running.
 */
export function signingSecret(): string {
  const explicit = process.env.RECEIPT_SIGNING_SECRET?.trim();
  if (explicit) return explicit;
  if (process.env.NODE_ENV === "production") {
    const session = process.env.SESSION_SECRET?.trim();
    if (!session) throw new Error("RECEIPT_SIGNING_SECRET (or SESSION_SECRET) is required in production");
    return crypto.createHmac("sha256", session).update("arcarna:receipt-unsubscribe:v1").digest("base64url");
  }
  return DEV_RECEIPT_SIGNING_KEY;
}

export function signUnsubscribeToken(customerId: string, email: string): string {
  const payload = `${customerId}|${email.toLowerCase()}`;
  const sig = crypto.createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  const data = Buffer.from(payload, "utf8").toString("base64url");
  return `${data}.${sig}`;
}

export function verifyUnsubscribeToken(
  token: string,
): { customerId: string; email: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  let payload: string;
  try {
    payload = Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  const sep = payload.indexOf("|");
  if (sep < 0) return null;
  return {
    customerId: payload.slice(0, sep),
    email: payload.slice(sep + 1),
  };
}
