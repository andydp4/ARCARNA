/**
 * Phone normalisation for WhatsApp.
 *
 * WhatsApp `wa_id` values are digits in international format without a leading
 * "+", e.g. "447805597760". We normalise local UK-style numbers (e.g.
 * "07805597760") to that form using the configured default country code so they
 * match stored customer phone numbers.
 */
import { normalizePhoneForMatch, phonesMatch } from "@shared/customerImport";

export { normalizePhoneForMatch, phonesMatch };

/**
 * Convert any input phone to digits-only international form (no "+").
 *
 * - Strips spaces, dashes, brackets and a leading "+".
 * - Converts a single leading "0" (national trunk prefix) to the country code.
 * - Leaves already-international numbers untouched.
 */
export function toWhatsappNumber(input: string, defaultCountryCode = "44"): string {
  if (!input) return "";
  let digits = input.replace(/[^\d+]/g, "");
  const hadPlus = digits.startsWith("+");
  digits = digits.replace(/\+/g, "");
  if (!digits) return "";

  if (hadPlus) return digits;

  const cc = defaultCountryCode.replace(/\D/g, "");
  // Local form with trunk prefix: 07805597760 -> 447805597760
  if (digits.startsWith("0")) {
    return cc + digits.replace(/^0+/, "");
  }
  // Already starts with the country code.
  if (cc && digits.startsWith(cc)) return digits;
  // Bare national number without trunk prefix — prepend country code.
  if (cc && digits.length <= 10) return cc + digits;
  return digits;
}

/** Display form with a leading "+" (e.g. "+447805597760"). */
export function toDisplayPhone(waNumber: string): string {
  const digits = waNumber.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}
