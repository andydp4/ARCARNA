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

// ---------------------------------------------------------------------------
// Device copies (PRV-07). What a till keeps on disk outlives the session that
// fetched it, so it is the cashier view whoever was signed in: a manager or
// admin's full rows must not be left behind for the next person on the till.
// ---------------------------------------------------------------------------

/** The only customer fields a device may keep (the cashier view, plus Q7's masks). */
export const DEVICE_CUSTOMER_FIELDS = [
  "id",
  "name",
  "category",
  "loyaltyPoints",
  "receiptEmailOptIn",
  "hasEmail",
  "hasPhone",
  "phoneLast4",
  "phoneMasked",
  "emailMasked",
] as const;

/**
 * One customer row cut down to what a device may keep. Masks are made here
 * from a full row (an admin's fetch) so the offline till still says ••4821;
 * the full values themselves never reach the cache.
 */
export function deviceCustomerRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of DEVICE_CUSTOMER_FIELDS) {
    if (field in row) out[field] = row[field];
  }
  if ("phone" in row || "email" in row) {
    const phone = typeof row.phone === "string" ? row.phone : "";
    const email = typeof row.email === "string" ? row.email : "";
    const digits = phone.replace(/\D/g, "");
    out.hasPhone = digits !== "";
    out.hasEmail = email.trim() !== "";
    out.phoneLast4 = digits.length >= 4 ? digits.slice(-4) : null;
    out.phoneMasked = maskPhone(phone);
    out.emailMasked = maskEmail(email);
  }
  return out;
}

/** Contact fields a queued customer edit or a draft must never hold. */
const DEVICE_CONTACT_FIELDS = ["phone", "email", "address", "phoneE164", "phone_e164", "replacePhone"] as const;

/**
 * A customer create/edit as it may wait on a device (PRV-07): no contact
 * details. They are typed again once the till is back online, where the
 * server takes them (and logs a replaced number).
 */
export function withoutContactDetails<T extends Record<string, unknown>>(data: T): Partial<T> {
  const out: Record<string, unknown> = { ...data };
  for (const field of DEVICE_CONTACT_FIELDS) delete out[field];
  return out as Partial<T>;
}

/** Whether a create/edit carried contact details a device may not keep. */
export function hasContactDetails(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  return DEVICE_CONTACT_FIELDS.some((f) => typeof data[f] === "string" && (data[f] as string).trim() !== "");
}

/**
 * A WhatsApp message as the inbox sends it (Q7/Q13a). `rawPayload` is Meta's
 * own message object, whose `from` is the sender's full number: the inbox never
 * reads it, so it is dropped for every role rather than masked.
 */
export function whatsappMessageForInbox<T extends Record<string, unknown>>(message: T): Omit<T, "rawPayload"> {
  const { rawPayload: _raw, ...rest } = message;
  return rest;
}
