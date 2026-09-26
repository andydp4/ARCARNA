/**
 * Stripe webhook signature check, done by hand (docs.stripe.com/webhooks,
 * "Verify webhook signatures manually") so no SDK is needed.
 *
 * Header: `Stripe-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>…][,v0=…]`.
 * Signed payload: `${t}.${raw body}`, HMAC-SHA256 with the endpoint's `whsec_`
 * secret. Only `v1` counts (anything else is ignored against downgrade), any
 * one matching `v1` is enough (a rolled secret sends two), compared in
 * constant time, and a timestamp outside the tolerance is refused so a
 * captured request cannot be replayed later.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Stripe's own libraries default to five minutes. */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureVerdict =
  | { ok: true; timestamp: number }
  | { ok: false; reason: "missing" | "malformed" | "no_match" | "too_old" };

export function verifyStripeSignature(
  rawBody: Buffer | string | undefined,
  header: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = STRIPE_SIGNATURE_TOLERANCE_SECONDS,
): SignatureVerdict {
  if (!secret || !header || rawBody === undefined) return { ok: false, reason: "missing" };
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = /^\d+$/.test(value) ? Number(value) : null;
    else if (key === "v1" && value) signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return { ok: false, reason: "malformed" };

  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`, "utf8")
    .update(body)
    .digest("hex");
  const matched = signatures.some((sig) => safeEqualHex(sig, expected));
  if (!matched) return { ok: false, reason: "no_match" };
  // Checked after the match, as Stripe does: only a genuine signature gets as
  // far as being judged on its age.
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { ok: false, reason: "too_old" };
  return { ok: true, timestamp };
}

/** Builds a header the way Stripe does — for tests. */
export function signStripePayload(rawBody: string, secret: string, timestamp: number): string {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
