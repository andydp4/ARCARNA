/**
 * Stripe configuration (v1.2 Stripe links).
 *
 * Environment only: the secret key and the webhook signing secret never live
 * in code or the database, are never logged and never reach the browser. The
 * feature is off, and hidden at the till, until both are set.
 */

/**
 * The Stripe API version this integration was written and checked against
 * (docs.stripe.com, September 2026). Sent on every request so an account
 * upgrade in the Stripe dashboard cannot change what our calls mean.
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

/** The events the webhook endpoint in Stripe should send. */
export const STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
] as const;

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
}

export function getStripeConfig(): StripeConfig {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY?.trim() ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "",
  };
}

/** Both secrets present: links can be made and their payments confirmed. */
export function isStripeConfigured(cfg: StripeConfig = getStripeConfig()): boolean {
  return !!cfg.secretKey && !!cfg.webhookSecret;
}

/** Test or live, read from the key's prefix — the key itself is never shown. */
export function stripeKeyMode(cfg: StripeConfig = getStripeConfig()): "test" | "live" | null {
  const key = cfg.secretKey;
  if (!key) return null;
  if (/^(sk|rk)_test_/.test(key)) return "test";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  return null;
}
