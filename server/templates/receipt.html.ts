export type ReceiptLine = {
  name: string;
  qty: number;
  price: string;
  lineTotal: string;
};

export type ReceiptRenderContext = {
  org: { name: string; logoUrl: string };
  customer: { name: string };
  order: {
    number: string;
    total: string;
    subtotal: string;
    tax: string;
    paymentMethod: string;
    loyaltyEarned: string;
    lines: ReceiptLine[];
  };
  unsubscribeUrl: string;
  footer?: string;
};

export const DEFAULT_RECEIPT_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt {{order.number}}</title>
  <style>
    body { font-family: system-ui, sans-serif; color: #111; max-width: 560px; margin: 0 auto; padding: 24px; }
    .logo { max-height: 48px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { text-align: left; padding: 8px 4px; border-bottom: 1px solid #eee; }
    th { font-size: 12px; text-transform: uppercase; color: #666; }
    .totals td { border: none; }
    .totals .label { color: #666; }
    .footer { margin-top: 24px; font-size: 12px; color: #666; }
    .unsub { margin-top: 16px; font-size: 11px; }
  </style>
</head>
<body>
  {{#org.logoUrl}}<img class="logo" src="{{org.logoUrl}}" alt="{{org.name}}" />{{/org.logoUrl}}
  <h1>{{org.name}}</h1>
  <p>Hi {{customer.name}},</p>
  <p>Thank you for your purchase. Order <strong>{{order.number}}</strong></p>
  <table>
    <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
    <tbody>
      {{#order.lines}}
      <tr>
        <td>{{name}}</td>
        <td>{{qty}}</td>
        <td>{{price}}</td>
        <td>{{lineTotal}}</td>
      </tr>
      {{/order.lines}}
    </tbody>
  </table>
  <table class="totals">
    <tr><td class="label">Subtotal</td><td>{{order.subtotal}}</td></tr>
    <tr><td class="label">Tax</td><td>{{order.tax}}</td></tr>
    <tr><td class="label"><strong>Total</strong></td><td><strong>{{order.total}}</strong></td></tr>
    <tr><td class="label">Payment</td><td>{{order.paymentMethod}}</td></tr>
    <tr><td class="label">Loyalty earned</td><td>{{order.loyaltyEarned}} pts</td></tr>
  </table>
  <p class="footer">{{footer}}</p>
  <p class="unsub"><a href="{{unsubscribeUrl}}">Unsubscribe</a> from email receipts.</p>
</body>
</html>`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function replaceScalar(html: string, key: string, value: string): string {
  const safe = escapeHtml(value);
  return html.replace(new RegExp(`\\{\\{${key.replace(/\./g, "\\.")}\\}\\}`, "g"), safe);
}

function renderConditionalBlocks(html: string, flags: Record<string, boolean>): string {
  let out = html;
  for (const [key, show] of Object.entries(flags)) {
    const re = new RegExp(`\\{\\{#${key.replace(/\./g, "\\.")}\\}\\}([\\s\\S]*?)\\{\\{/${key.replace(/\./g, "\\.")}\\}\\}`, "g");
    out = out.replace(re, show ? "$1" : "");
  }
  return out;
}

function renderLineBlock(html: string, lines: ReceiptLine[]): string {
  const blockRe = /\{\{#order\.lines\}\}([\s\S]*?)\{\{\/order\.lines\}\}/;
  const match = html.match(blockRe);
  if (!match) return html;
  const rowTpl = match[1];
  const rows = lines
    .map((line) =>
      rowTpl
        .replace(/\{\{name\}\}/g, escapeHtml(line.name))
        .replace(/\{\{qty\}\}/g, escapeHtml(String(line.qty)))
        .replace(/\{\{price\}\}/g, escapeHtml(line.price))
        .replace(/\{\{lineTotal\}\}/g, escapeHtml(line.lineTotal)),
    )
    .join("");
  return html.replace(blockRe, rows);
}

export function renderReceiptTemplate(
  templateHtml: string,
  ctx: ReceiptRenderContext,
): string {
  let html = templateHtml || DEFAULT_RECEIPT_TEMPLATE;
  html = renderLineBlock(html, ctx.order.lines);
  html = renderConditionalBlocks(html, { "org.logoUrl": !!ctx.org.logoUrl });
  const scalars: Record<string, string> = {
    "org.name": ctx.org.name,
    "org.logoUrl": ctx.org.logoUrl,
    "customer.name": ctx.customer.name,
    "order.number": ctx.order.number,
    "order.total": ctx.order.total,
    "order.subtotal": ctx.order.subtotal,
    "order.tax": ctx.order.tax,
    "order.paymentMethod": ctx.order.paymentMethod,
    "order.loyaltyEarned": ctx.order.loyaltyEarned,
    unsubscribeUrl: ctx.unsubscribeUrl,
    footer: ctx.footer ?? "",
  };
  for (const [key, value] of Object.entries(scalars)) {
    html = replaceScalar(html, key, value);
  }
  return html;
}

export function buildSampleReceiptContext(unsubscribeUrl: string): ReceiptRenderContext {
  return {
    org: { name: "Midnight Retail", logoUrl: "" },
    customer: { name: "Alex Sample" },
    order: {
      number: "ORD-SAMPLE",
      subtotal: "£41.67",
      tax: "£8.33",
      total: "£50.00",
      paymentMethod: "Card",
      loyaltyEarned: "50",
      lines: [
        { name: "Espresso Beans 250g", qty: 2, price: "£12.00", lineTotal: "£24.00" },
        { name: "Ceramic Mug", qty: 1, price: "£17.67", lineTotal: "£17.67" },
      ],
    },
    unsubscribeUrl,
    footer: "Thank you for shopping with us.",
  };
}
