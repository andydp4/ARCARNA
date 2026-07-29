/**
 * Canonical Arcarna product vocabulary — single source of truth for
 * user-facing surface names (nav labels, page headers, command palette).
 *
 * Values are taken verbatim from
 * `docs/specs/ARCARNA_LANGUAGE_SPECIFICATION.md` §1 (global renames) and §3
 * (navigation language). Import from here instead of hardcoding names so a
 * rename happens in one place and nav ↔ page-title ↔ palette never drift.
 *
 * Note: "Notifications" is deliberately kept as "Notifications" (the proposed
 * "Signals" was rejected by the owner as unfriendly jargon), even though the
 * Language spec §3 calls the Notification Center "Signals".
 */
const CANONICAL = {
  // §1 — global renames
  controlCentre: "Control Centre", // was: Dashboard / Home
  truths: "Truths", // was: Insights / Business Insights (and the interim "Truths Hub")
  evidence: "Evidence", // was: Reports (§12 — the noun is Evidence)
  createOrder: "Create Order", // POS — single term

  // §3 — approved navigation labels
  openOrders: "Open Orders",
  inventory: "Inventory", // was: the interim "Stock Truths"
  customerSegments: "Customer Segments", // was: RFM Segments / the interim "Customer Truths"
  profitAnalysis: "Profit Analysis", // was: the interim "Profit Truths"
  scheduledEvidence: "Scheduled Evidence", // was: Scheduled reports

  // Surfaces outside the nav table
  businessTruths: "Business Truths", // was: Business Health
  discoveryJourney: "Discovery Journey", // was: Onboarding / Setup
  notifications: "Notifications", // kept per owner (not "Signals")
} as const;

export const VOCAB = {
  ...CANONICAL,

  /** @deprecated Use `truths`. The approved label is "Truths" (Language spec §3). */
  truthsHub: CANONICAL.truths,
  /** @deprecated Use `inventory`. The approved label is "Inventory" (Language spec §3). */
  stockTruths: CANONICAL.inventory,
  /** @deprecated Use `customerSegments` (Language spec §3). */
  customerTruths: CANONICAL.customerSegments,
  /** @deprecated Use `profitAnalysis` (Language spec §3). */
  profitTruths: CANONICAL.profitAnalysis,
} as const;

export type VocabKey = keyof typeof VOCAB;
