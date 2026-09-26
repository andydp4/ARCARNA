/**
 * The three Stripe calls Card (link) needs, over plain HTTPS: create a
 * Checkout Session, read one back, and expire one. Checkout Sessions (not
 * Payment Links) because a session is made per order for an exact amount,
 * carries our order id in its metadata, expires on a time we choose, and
 * fires `checkout.session.completed` when paid; a Payment Link is a reusable
 * product page with none of those per order.
 *
 * Errors come back as values with Stripe's own message; the secret key is
 * never part of any message or log line.
 */
import { STRIPE_API_VERSION, getStripeConfig, type StripeConfig } from "./config";

const STRIPE_API = "https://api.stripe.com/v1";
const TIMEOUT_MS = 15_000;

/** The fields of a Checkout Session arcarna reads. */
export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  status: "open" | "complete" | "expired" | string;
  payment_status: "paid" | "unpaid" | "no_payment_required" | string;
  amount_total: number | null;
  currency: string | null;
  payment_intent: string | null | { id: string };
  expires_at: number | null;
  client_reference_id: string | null;
  metadata: Record<string, string> | null;
}

export type StripeResult<T> = { ok: true; value: T } | { ok: false; status: number | null; message: string; code?: string };

/** Stripe's form encoding: nested keys as `a[b][c]=v`. */
export function encodeForm(params: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === "object") out.push(...encodeForm(item as Record<string, unknown>, `${name}[${i}]`));
        else out.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof value === "object") {
      out.push(...encodeForm(value as Record<string, unknown>, name));
    } else {
      out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return out;
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  cfg: StripeConfig,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<StripeResult<T>> {
  if (!cfg.secretKey) return { ok: false, status: null, message: "Stripe is not set up" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${STRIPE_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.secretKey}`,
        "Stripe-Version": STRIPE_API_VERSION,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body ? encodeForm(body).join("&") : undefined,
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (res.ok && json) return { ok: true, value: json as T };
    const err = json?.error as { message?: string; code?: string } | undefined;
    return { ok: false, status: res.status, message: err?.message ?? `Stripe answered ${res.status}`, code: err?.code };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, status: null, message: aborted ? "Stripe did not answer in time" : "Could not reach Stripe" };
  } finally {
    clearTimeout(timer);
  }
}

export interface CreateSessionInput {
  amountMinor: number;
  currency: string;
  /** What the customer sees on Stripe's page. */
  description: string;
  orgId: string;
  orderId: string;
  linkId: string;
  paymentId: string;
  expiresAt: Date;
  successUrl: string;
}

export function createCheckoutSession(
  input: CreateSessionInput,
  cfg: StripeConfig = getStripeConfig(),
): Promise<StripeResult<StripeCheckoutSession>> {
  const metadata = {
    org_id: input.orgId,
    order_id: input.orderId,
    link_id: input.linkId,
    payment_id: input.paymentId,
  };
  return call<StripeCheckoutSession>(
    "POST",
    "/checkout/sessions",
    cfg,
    {
      mode: "payment",
      client_reference_id: input.orderId,
      success_url: input.successUrl,
      expires_at: Math.floor(input.expiresAt.getTime() / 1000),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amountMinor,
            product_data: { name: input.description },
          },
        },
      ],
      metadata,
      payment_intent_data: { metadata, description: input.description },
    },
    // One link row, one session: a retried request cannot make a second.
    `arcarna-card-link-${input.linkId}`,
  );
}

export function retrieveCheckoutSession(
  sessionId: string,
  cfg: StripeConfig = getStripeConfig(),
): Promise<StripeResult<StripeCheckoutSession>> {
  return call<StripeCheckoutSession>("GET", `/checkout/sessions/${encodeURIComponent(sessionId)}`, cfg);
}

export function expireCheckoutSession(
  sessionId: string,
  cfg: StripeConfig = getStripeConfig(),
): Promise<StripeResult<StripeCheckoutSession>> {
  return call<StripeCheckoutSession>("POST", `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, cfg, {});
}

export function paymentIntentId(session: Pick<StripeCheckoutSession, "payment_intent">): string | null {
  const pi = session.payment_intent;
  if (!pi) return null;
  return typeof pi === "string" ? pi : pi.id ?? null;
}
