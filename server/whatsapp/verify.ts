/**
 * WhatsApp webhook verification.
 *
 * - GET handshake: Meta sends hub.mode/hub.verify_token/hub.challenge. We echo
 *   the challenge only when the token matches our configured verify token.
 * - POST signature: Meta signs the raw request body with the app secret using
 *   HMAC-SHA256 and sends it as the `X-Hub-Signature-256: sha256=<hex>` header.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface WebhookChallengeQuery {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}

/**
 * Validate the GET verification handshake.
 * Returns the challenge string to echo back, or null when verification fails.
 */
export function verifyWebhookChallenge(
  query: WebhookChallengeQuery,
  expectedVerifyToken: string,
): string | null {
  if (!expectedVerifyToken) return null;
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode === "subscribe" && token && safeEqual(token, expectedVerifyToken)) {
    return challenge ?? "";
  }
  return null;
}

/**
 * Verify the X-Hub-Signature-256 HMAC over the raw request body.
 * Returns false on any malformed input or mismatch.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string | undefined,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!appSecret || !signatureHeader || rawBody === undefined) return false;
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;
  if (!provided) return false;

  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expected = createHmac("sha256", appSecret).update(body).digest("hex");
  return safeEqual(provided, expected);
}

/** Constant-time string comparison that tolerates length mismatches. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  try {
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
