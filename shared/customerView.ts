/**
 * The customer's contact details as each role may see them (v1.2 Phase 5,
 * PRV-03, PRV-06). Pure: shared by the server's customer view, the till and
 * the tests. The rules themselves (who sees what) are in shared/accessPolicy.ts;
 * this file only knows how to format and mask.
 */

/** The bullet the masks use. A value containing it came from a mask and is never saved. */
export const MASK_CHAR = "•";

export function isMaskedValue(value: unknown): boolean {
  return typeof value === "string" && value.includes(MASK_CHAR);
}

/**
 * A UK phone number as +44 E.164, or null when it is not one we can read.
 * The same rule as the database's `arcarna_format_uk_phone` (migration 120),
 * which keeps `customers.phone_e164`; customerViews.test.ts holds them together.
 * Exact formatting only: there are no partial matches (PRV-06).
 */
export function formatUkPhone(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/[^0-9]/g, "");
  if (/^0044[1-9][0-9]{8,9}$/.test(d)) return `+${d.slice(2)}`;
  if (/^44[1-9][0-9]{8,9}$/.test(d)) return `+${d}`;
  if (/^440[1-9][0-9]{8,9}$/.test(d)) return `+44${d.slice(3)}`;
  if (/^0[1-9][0-9]{8,9}$/.test(d)) return `+44${d.slice(1)}`;
  if (/^7[0-9]{9}$/.test(d)) return `+44${d}`;
  return null;
}

/** "••4821": enough to tell two Janes apart, not enough to ring either. */
export function maskPhone(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 4) return digits.length > 0 ? `${MASK_CHAR}${MASK_CHAR}` : null;
  return `${MASK_CHAR}${MASK_CHAR}${digits.slice(-4)}`;
}

/** "j•••@gmail.com" (Q7): the receipt toggle can say where it is going. */
export function maskEmail(raw: string | null | undefined): string | null {
  const email = String(raw ?? "").trim();
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0) return `${MASK_CHAR}${MASK_CHAR}${MASK_CHAR}`;
  return `${email[0]}${MASK_CHAR}${MASK_CHAR}${MASK_CHAR}${email.slice(at)}`;
}

/** "Jane S." — how the duplicate prompt names someone without their full name. */
export function shortName(name: string | null | undefined): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Someone";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** What a lookup or duplicate prompt hands back: a way to pick the person, nothing to ring. */
export type CustomerMatch = {
  id: string;
  displayName: string;
  phoneMasked: string | null;
};

/** The duplicate prompt, in the owner's words (PRV-06). */
export function duplicatePrompt(match: CustomerMatch): string {
  const phoneHint = match.phoneMasked ? ` (${match.phoneMasked})` : "";
  return `Already on the system: ${match.displayName}${phoneHint}, use them?`;
}
