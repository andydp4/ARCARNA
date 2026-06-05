import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhookChallenge, verifyWebhookSignature } from "../whatsapp/verify";

describe("whatsapp webhook challenge", () => {
  it("echoes the challenge when mode and token match", () => {
    const out = verifyWebhookChallenge(
      { "hub.mode": "subscribe", "hub.verify_token": "secret", "hub.challenge": "12345" },
      "secret",
    );
    expect(out).toBe("12345");
  });

  it("rejects a wrong verify token", () => {
    const out = verifyWebhookChallenge(
      { "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "12345" },
      "secret",
    );
    expect(out).toBeNull();
  });

  it("rejects when mode is not subscribe", () => {
    const out = verifyWebhookChallenge(
      { "hub.mode": "delete", "hub.verify_token": "secret", "hub.challenge": "x" },
      "secret",
    );
    expect(out).toBeNull();
  });

  it("rejects when no expected token configured", () => {
    expect(verifyWebhookChallenge({ "hub.mode": "subscribe", "hub.verify_token": "" }, "")).toBeNull();
  });
});

describe("whatsapp webhook signature", () => {
  const secret = "app-secret";
  const body = JSON.stringify({ hello: "world", n: 1 });
  const validSig = "sha256=" + createHmac("sha256", secret).update(Buffer.from(body)).digest("hex");

  it("accepts a valid signature over the raw body", () => {
    expect(verifyWebhookSignature(Buffer.from(body), validSig, secret)).toBe(true);
  });

  it("accepts a signature without the sha256= prefix", () => {
    const bare = createHmac("sha256", secret).update(Buffer.from(body)).digest("hex");
    expect(verifyWebhookSignature(Buffer.from(body), bare, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyWebhookSignature(Buffer.from(body + "x"), validSig, secret)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyWebhookSignature(Buffer.from(body), validSig, "other-secret")).toBe(false);
  });

  it("rejects when signature header or body is missing", () => {
    expect(verifyWebhookSignature(Buffer.from(body), undefined, secret)).toBe(false);
    expect(verifyWebhookSignature(undefined, validSig, secret)).toBe(false);
    expect(verifyWebhookSignature(Buffer.from(body), validSig, "")).toBe(false);
  });
});
