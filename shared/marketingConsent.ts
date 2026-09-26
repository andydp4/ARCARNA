/**
 * Marketing messages need the customer's consent first (v1.2 Phase 0B, PRV-14).
 *
 * WhatsApp's own categories do the sorting: a UTILITY template (order ready,
 * delivery update) answers something the customer asked for; a MARKETING one
 * is selling to them, and under PECR that needs their consent on record.
 *
 * arcarna does not record marketing consent yet, so every customer reads as
 * "no consent" and marketing templates are refused until it does. When a
 * consent record lands, only `consentRecordedAt` needs to be filled in.
 */

export type TemplateLike = { category?: string | null } | null | undefined;

/**
 * A template counts as marketing when WhatsApp says so — or when we do not
 * know its category (a name not in our synced list, or a row synced without
 * one), because sending an unknown template must not be a way round the rule.
 */
export function isMarketingTemplate(template: TemplateLike): boolean {
  const category = template?.category?.trim().toUpperCase();
  if (!category) return true;
  return category === "MARKETING";
}

export type MarketingConsent = { consentRecordedAt: Date | string | null } | null | undefined;

export type TemplateConsentVerdict =
  | { ok: true }
  | { ok: false; code: "marketing_consent_required"; message: string };

export function checkTemplateConsent(template: TemplateLike, consent: MarketingConsent): TemplateConsentVerdict {
  if (!isMarketingTemplate(template)) return { ok: true };
  if (consent?.consentRecordedAt) return { ok: true };
  return {
    ok: false,
    code: "marketing_consent_required",
    message:
      "This is a marketing template. It can only be sent once the customer's consent to marketing is recorded, and arcarna does not record that yet.",
  };
}
