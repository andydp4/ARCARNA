/**
 * The Stripe-Signature check (v1.2 Stripe links), done by hand as
 * docs.stripe.com/webhooks describes: HMAC-SHA256 of `${t}.${raw body}`, only
 * `v1` counts, any matching `v1` is enough, and an old timestamp is a replay.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signStripePayload, verifyStripeSignature } from "../stripe/verify";
import { encodeForm } from "../stripe/client";

const SECRET = "whsec_unit_test";
const BODY = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
const NOW = 1_790_000_000;

describe("verifyStripeSignature", () => {
  it("accepts a genuine signature", () => {
    expect(verifyStripeSignature(BODY, signStripePayload(BODY, SECRET, NOW), SECRET, NOW)).toEqual({ ok: true, timestamp: NOW });
    expect(verifyStripeSignature(Buffer.from(BODY), signStripePayload(BODY, SECRET, NOW), SECRET, NOW).ok).toBe(true);
  });

  it("refuses a different secret, a changed body and a missing header", () => {
    expect(verifyStripeSignature(BODY, signStripePayload(BODY, "whsec_other", NOW), SECRET, NOW)).toEqual({ ok: false, reason: "no_match" });
    expect(verifyStripeSignature(BODY.replace("evt_1", "evt_2"), signStripePayload(BODY, SECRET, NOW), SECRET, NOW).ok).toBe(false);
    expect(verifyStripeSignature(BODY, undefined, SECRET, NOW)).toEqual({ ok: false, reason: "missing" });
    expect(verifyStripeSignature(BODY, "nonsense", SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses a genuine request replayed after five minutes", () => {
    const header = signStripePayload(BODY, SECRET, NOW - 301);
    expect(verifyStripeSignature(BODY, header, SECRET, NOW)).toEqual({ ok: false, reason: "too_old" });
    expect(verifyStripeSignature(BODY, signStripePayload(BODY, SECRET, NOW - 299), SECRET, NOW).ok).toBe(true);
  });

  it("accepts any matching v1 (a rolled secret) and ignores v0", () => {
    const good = createHmac("sha256", SECRET).update(`${NOW}.${BODY}`).digest("hex");
    expect(verifyStripeSignature(BODY, `t=${NOW},v1=${"0".repeat(64)},v1=${good}`, SECRET, NOW).ok).toBe(true);
    expect(verifyStripeSignature(BODY, `t=${NOW},v0=${good}`, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("encodeForm", () => {
  it("encodes nested params the way Stripe reads them", () => {
    const out = encodeForm({ mode: "payment", line_items: [{ quantity: 1, price_data: { unit_amount: 250 } }], metadata: { order_id: "o 1" } });
    expect(out).toEqual([
      "mode=payment",
      `${encodeURIComponent("line_items[0][quantity]")}=1`,
      `${encodeURIComponent("line_items[0][price_data][unit_amount]")}=250`,
      `${encodeURIComponent("metadata[order_id]")}=o%201`,
    ]);
  });
});
