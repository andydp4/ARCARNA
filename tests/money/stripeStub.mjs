/**
 * Test-only preload: answers the three Stripe Checkout calls in-process so a
 * dev server can take Card (link) sales without the network.
 *
 *   NODE_OPTIONS="--import ./tests/money/stripeStub.mjs" npm run dev:e2e
 *
 * Sessions are kept in memory. The money dataset then marks one paid by
 * posting a correctly signed `checkout.session.completed` to the real
 * webhook, so everything after Stripe is the app's own code path.
 */
const STRIPE = "https://api.stripe.com/v1";
const sessions = new Map();
const realFetch = globalThis.fetch;

function formToObject(body) {
  const out = {};
  for (const [k, v] of new URLSearchParams(String(body ?? ""))) out[k] = v;
  return out;
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.startsWith(STRIPE)) return realFetch(input, init);
  const path = url.slice(STRIPE.length);
  const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
  if (init.method === "POST" && path === "/checkout/sessions") {
    const f = formToObject(init.body);
    const id = `cs_test_${Math.random().toString(36).slice(2, 14)}`;
    const session = {
      id,
      url: `https://checkout.stripe.test/${id}`,
      status: "open",
      payment_status: "unpaid",
      amount_total: Number(f["line_items[0][price_data][unit_amount]"]),
      currency: f["line_items[0][price_data][currency]"],
      payment_intent: null,
      expires_at: Number(f.expires_at),
      client_reference_id: f.client_reference_id,
      metadata: {
        org_id: f["metadata[org_id]"],
        order_id: f["metadata[order_id]"],
        link_id: f["metadata[link_id]"],
        payment_id: f["metadata[payment_id]"],
      },
    };
    sessions.set(id, session);
    return json(200, session);
  }
  const m = path.match(/^\/checkout\/sessions\/([^/]+)(\/expire)?$/);
  if (m) {
    const s = sessions.get(m[1]);
    if (!s) return json(404, { error: { message: "No such checkout session" } });
    if (m[2]) s.status = "expired";
    return json(200, s);
  }
  return json(404, { error: { message: `stub: ${path} not handled` } });
};
