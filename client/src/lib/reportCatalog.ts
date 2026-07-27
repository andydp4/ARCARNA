/**
 * Catalog of all Arcarna exportable reports (ARC-RPT-SPEC-001).
 * Single source of truth for the Reports hub, routing, and each report page's
 * header metadata. Purposes are the spec's plain-English tooltips verbatim.
 */
export type ReportTier = 1 | 2 | 3 | 4;

export interface ReportCatalogEntry {
  ref: string;
  title: string;
  tier: ReportTier;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "REAL-TIME";
  purpose: string;
  /** In-app route for the report view. */
  route: string;
  /** Exportable formats offered on screen. All support PNG/JPEG/PDF; most add CSV. */
  formats: ("PNG" | "JPEG" | "PDF" | "CSV")[];
  /** "available" = built & routed; "planned" = catalogued, view not built yet. */
  status: "available" | "planned";
}

const ALL: ("PNG" | "JPEG" | "PDF" | "CSV")[] = ["PNG", "JPEG", "PDF", "CSV"];

export const REPORT_CATALOG: ReportCatalogEntry[] = [
  // ── Tier 1 — Basic (build first) ──────────────────────────────────────────
  {
    ref: "ARC-T1-001",
    title: "Daily Sales Summary",
    tier: 1,
    frequency: "DAILY",
    purpose:
      "Use this every morning to see exactly how much revenue came in yesterday, broken down by payment channel.",
    route: "/reports/daily-sales",
    formats: ALL,
    status: "available",
  },
  {
    ref: "ARC-T1-002",
    title: "Current Stock Levels",
    tier: 1,
    frequency: "REAL-TIME",
    purpose:
      "Shows exactly how many units of every product are currently in stock. Use before confirming any order and during stock counts.",
    route: "/reports/current-stock",
    formats: ALL,
    status: "available",
  },
  {
    ref: "ARC-T1-003",
    title: "Order Status Dashboard",
    tier: 1,
    frequency: "REAL-TIME",
    purpose:
      "Live view of every order right now — what's queued, being prepped, ready, and delayed. The primary working screen during a shift.",
    route: "/reports/order-status",
    formats: ["PNG", "JPEG", "PDF", "CSV"],
    status: "available",
  },
  {
    ref: "ARC-T1-004",
    title: "Weekly Sales Summary",
    tier: 1,
    frequency: "WEEKLY",
    purpose:
      "A complete picture of the trading week — revenue, orders, top products, and channel breakdown. Use it in your Monday review.",
    route: "/reports/weekly-sales",
    formats: ALL,
    status: "available",
  },
  {
    ref: "ARC-T1-005",
    title: "Delay Log",
    tier: 1,
    frequency: "DAILY",
    purpose:
      "Every delay today — what caused it, how long it lasted, and whether the customer was proactively notified. Use it to eliminate recurring causes.",
    route: "/reports/delay-log",
    formats: ["PNG", "JPEG", "PDF", "CSV"],
    status: "available",
  },
  // ── Tier 2 — Operational intelligence ─────────────────────────────────────
  {
    ref: "ARC-T2-001",
    title: "Weekly Margin Summary",
    tier: 2,
    frequency: "WEEKLY",
    purpose:
      "Shows the actual realised margin per product based on what you genuinely sold this week — real margin under dynamic pricing.",
    route: "/reports/weekly-margin",
    formats: ALL,
    status: "available",
  },
  {
    ref: "ARC-T2-002",
    title: "Staff KPI Performance Report",
    tier: 2,
    frequency: "WEEKLY",
    purpose:
      "Measures each staff member's performance against the 7 core KPIs every week — for bonus calculation and weekly check-ins.",
    route: "/reports/staff-kpi",
    formats: ["PNG", "JPEG", "PDF", "CSV"],
    status: "available",
  },
  {
    ref: "ARC-T2-003",
    title: "Customer Satisfaction Report",
    tier: 2,
    frequency: "WEEKLY",
    purpose:
      "Tracks every satisfaction score after a collection, and flags individual customers who had a poor experience so they can be followed up.",
    route: "/reports/satisfaction",
    formats: ALL,
    status: "available",
  },
  {
    ref: "ARC-T2-004",
    title: "Reseller Credit & Payment Report",
    tier: 2,
    frequency: "WEEKLY",
    purpose:
      "Every reseller partner's balance, payment history, and overdue amounts. Any balance over 14 days old triggers a supply hold.",
    route: "/reports/reseller-credit",
    formats: ["PNG", "JPEG", "PDF", "CSV"],
    status: "available",
  },
  // ── Tier 3 — Customer intelligence ────────────────────────────────────────
  {
    ref: "ARC-T3-001",
    title: "Customer Lapse & Retention Report",
    tier: 3,
    frequency: "WEEKLY",
    purpose:
      "Identifies customers showing early signs of churning before they disappear. Use it to decide who gets a reactivation message this week.",
    route: "/reports/lapse-retention",
    formats: ALL,
    status: "available",
  },
  {
    ref: "ARC-T3-002",
    title: "Customer Lifetime Value (CLV) Report",
    tier: 3,
    frequency: "MONTHLY",
    purpose:
      "Ranks every customer by total value — spend, order frequency, and margin combined. Use it to ensure top customers get VIP service.",
    route: "/reports/clv",
    formats: ["PNG", "JPEG", "PDF", "CSV"],
    status: "available",
  },
  {
    ref: "ARC-T3-003",
    title: "Stock Runway & Demand Forecast",
    tier: 3,
    frequency: "WEEKLY",
    purpose:
      "Predicts how many weeks of stock remain at the current pace and recommends when to reorder, accounting for supplier lead times.",
    route: "/reports/stock-runway",
    formats: ALL,
    status: "available",
  },
  // ── Tier 4 — Advanced & predictive ────────────────────────────────────────
  {
    ref: "ARC-T4-001",
    title: "RFM Customer Segmentation",
    tier: 4,
    frequency: "MONTHLY",
    purpose:
      "Scores every customer on Recency, Frequency and Monetary value and places them in an action segment. Know exactly who to contact and how.",
    route: "/reports/rfm",
    formats: ["PNG", "JPEG", "PDF", "CSV"],
    status: "available",
  },
  {
    ref: "ARC-T4-002",
    title: "Churn Risk Score",
    tier: 4,
    frequency: "WEEKLY",
    purpose:
      "Predicts which customers are likely to stop ordering before the standard 14-day lapse flag fires — an early warning system.",
    route: "/reports/churn-risk",
    formats: ["PNG", "JPEG", "PDF", "CSV"],
    status: "available",
  },
  {
    ref: "ARC-T4-003",
    title: "Product Affinity & Cross-Sell Report",
    tier: 4,
    frequency: "MONTHLY",
    purpose:
      "Identifies which products are most frequently bought together — for cross-sell training, bundles, and personalised messages.",
    route: "/reports/affinity",
    formats: ["PNG", "JPEG", "PDF", "CSV"],
    status: "available",
  },
];

export const TIER_LABEL: Record<ReportTier, string> = {
  1: "Tier 1 · Basic",
  2: "Tier 2 · Operational Intelligence",
  3: "Tier 3 · Customer Intelligence",
  4: "Tier 4 · Advanced & Predictive",
};

export function reportByRef(ref: string): ReportCatalogEntry | undefined {
  return REPORT_CATALOG.find((r) => r.ref === ref);
}
