/**
 * Take out what looks like a customer's contact or card details from free
 * text. Deliberately blunt: a false positive costs a word, a miss puts
 * personal data somewhere it should not be. Used by the "Problem?" note
 * (v1.2 Phase 8A) and by Ask arcarna's stored questions.
 */
export const SCRUBBED = "[removed]";

export function scrubContactDetails(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, SCRUBBED)
    // Card numbers: 13–19 digits, allowing spaces or dashes between groups.
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, SCRUBBED)
    // UK phone numbers: +44 or 0, then 9–10 more digits with optional spaces.
    .replace(/(?:\+44\s?|\b0)(?:\d[\s-]?){9,10}\b/g, SCRUBBED)
    // Postcodes (e.g. "SW1A 1AA", "M1 1AE").
    .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, SCRUBBED);
}
