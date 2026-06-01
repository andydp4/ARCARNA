import crypto from "crypto";

function signingSecret(): string {
  return process.env.RECEIPT_SIGNING_SECRET?.trim() || "dev-receipt-signing-change-me";
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
