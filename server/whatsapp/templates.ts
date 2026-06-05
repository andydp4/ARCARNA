/**
 * Seed WhatsApp message templates.
 *
 * These are starting points only — they are NOT approved by Meta until submitted
 * and reviewed in the WhatsApp Manager. They are stored with status "LOCAL" and
 * become "APPROVED" after a template sync confirms Meta approval.
 */

export interface SeedTemplate {
  templateName: string;
  category: string;
  language: string;
  body: string;
}

export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    templateName: "order_confirmation",
    category: "UTILITY",
    language: "en_GB",
    body: "Hi {{1}}, thanks for your order. We've got {{2}} confirmed. Total is {{3}}. Collection/delivery: {{4}}.",
  },
  {
    templateName: "order_ready",
    category: "UTILITY",
    language: "en_GB",
    body: "Hi {{1}}, your order is ready. Collection address/details: {{2}}.",
  },
  {
    templateName: "stock_update",
    category: "UTILITY",
    language: "en_GB",
    body: "Hi {{1}}, quick update: {{2}} is currently unavailable. Alternative available: {{3}}.",
  },
  {
    templateName: "payment_reminder",
    category: "UTILITY",
    language: "en_GB",
    body: "Hi {{1}}, just a quick reminder your order total is {{2}}. Payment details: {{3}}.",
  },
  {
    templateName: "delivery_update",
    category: "UTILITY",
    language: "en_GB",
    body: "Hi {{1}}, an update on your delivery: {{2}}. Estimated time: {{3}}.",
  },
  {
    templateName: "thanks_follow_up",
    category: "MARKETING",
    language: "en_GB",
    body: "Hi {{1}}, thanks for shopping with us! Let us know if there's anything else we can help with.",
  },
  {
    templateName: "opening_hours",
    category: "UTILITY",
    language: "en_GB",
    body: "Hi {{1}}, our opening hours are {{2}}. We'll reply as soon as we're back.",
  },
];

/** Extract {{n}} placeholders from a template body. */
export function extractVariables(body: string): string[] {
  return (body.match(/\{\{\d+\}\}/g) ?? []).map((v) => v);
}
