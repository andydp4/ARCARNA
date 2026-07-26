/**
 * Canonical Arcarna product vocabulary — single source of truth for
 * user-facing surface names (nav labels, page headers, command palette).
 *
 * Import from here instead of hardcoding names so a rename happens in one place
 * and nav ↔ page-title ↔ palette never drift.
 *
 * Mapping approved by owner. Note: "Notifications" is deliberately kept as
 * "Notifications" (the proposed "Signals" was rejected as unfriendly jargon).
 */
export const VOCAB = {
  controlCentre: "Control Centre", // was: Dashboard / Home
  truthsHub: "Truths Hub", // was: Insights / Reports / Analytics hub
  stockTruths: "Stock Truths", // was: Inventory
  customerTruths: "Customer Truths", // was: RFM / Customer Segments
  profitTruths: "Profit Truths", // was: Profit Analysis / Expense reports
  businessTruths: "Business Truths", // was: Business Health
  discoveryJourney: "Discovery Journey", // was: Onboarding / Setup
  createOrder: "Create Order", // POS — single term
  openOrders: "Open Orders",
  notifications: "Notifications", // kept per owner (not "Signals")
} as const;

export type VocabKey = keyof typeof VOCAB;
