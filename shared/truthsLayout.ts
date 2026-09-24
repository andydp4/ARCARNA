import { evidenceRefMinRole, isAtLeast } from "./accessPolicy";
import { REPORT_CATALOG, type ReportCatalogEntry } from "./evidenceCatalog";
import type { Role } from "./rbac";

/**
 * Truths at a glance (v1.2 Phase 3): the Truths Centre's landing page is a
 * set of widgets, one layout for the whole org, set by admins (owner
 * decision). This file is the catalogue of widgets an admin may add, the
 * rules a saved layout must follow, and the role filter for viewers — shared
 * so the server enforces exactly what the editor offers.
 */

export const TRUTHS_LAYOUT_EDIT_MIN_ROLE: Role = "ADMIN";
export const TRUTHS_LAYOUT_VIEW_MIN_ROLE: Role = "MANAGER";

/**
 * More than this is a wall, not a glance; it also bounds the stored JSON.
 * Raised from 30 when Order Timing and Staff Performance became available
 * Evidence (v1.2 Phase 7): the whole catalogue must still fit, one of each.
 */
export const TRUTHS_LAYOUT_MAX_WIDGETS = 40;

export const WIDGET_SIZES = ["small", "medium", "large"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];
export const WIDGET_SIZE_LABEL: Record<WidgetSize, string> = {
  small: "Small (a third)",
  medium: "Medium (half)",
  large: "Large (full width)",
};

/**
 * The time window a widget reads. Every widget states its window on its face,
 * so a number is never read without knowing what period it covers.
 */
export const TRUTHS_WINDOWS = {
  today: "Today",
  week: "This week",
  month: "This month",
  last7: "Last 7 days",
  last30: "Last 30 days",
  last90: "Last 90 days",
  last180: "Last 180 days",
  quarter: "This quarter",
  year: "This year",
  last4w: "Last 4 weeks",
  last12w: "Last 12 weeks",
  last26w: "Last 26 weeks",
  now: "Right now",
  latest: "Latest scoring run",
  none: "Not time-bound",
} as const;
export type TruthsWindow = keyof typeof TRUTHS_WINDOWS;

const PERIOD_WINDOWS: TruthsWindow[] = ["month", "today", "week", "last7", "last30", "quarter", "year"];

export type WidgetGroup = "truth" | "evidence" | "guide";

export type TruthsWidgetDef = {
  id: string;
  label: string;
  group: WidgetGroup;
  /** What it shows, in the add-widget dropdown and the widget's own subtitle. */
  description: string;
  minRole: Role;
  /** Windows an admin may pick; the first is the default. */
  windows: readonly TruthsWindow[];
  defaultSize: WidgetSize;
  /** The full page behind the widget. */
  href: string;
  /** Evidence widgets: the report reference. */
  evidenceRef?: string;
};

/**
 * Visual Truths. The first eight are today's Truths Hub (/insights) charts,
 * which became widgets when /insights started redirecting here.
 */
const TRUTH_WIDGETS: TruthsWidgetDef[] = [
  { id: "sales-summary", label: "Sales at a glance", group: "truth", description: "Revenue, orders, active customers and average order value.", minRole: "MANAGER", windows: PERIOD_WINDOWS, defaultSize: "large", href: "/reports/weekly-sales" },
  { id: "revenue-by-day", label: "Revenue by day", group: "truth", description: "Daily revenue and order count.", minRole: "MANAGER", windows: PERIOD_WINDOWS, defaultSize: "large", href: "/reports/daily-sales" },
  { id: "revenue-by-category", label: "Revenue by category", group: "truth", description: "Share of revenue by product category.", minRole: "MANAGER", windows: PERIOD_WINDOWS, defaultSize: "medium", href: "/reports/weekly-sales" },
  { id: "payment-methods", label: "Payment methods", group: "truth", description: "Orders and revenue by tender type.", minRole: "MANAGER", windows: PERIOD_WINDOWS, defaultSize: "medium", href: "/reports/daily-sales" },
  { id: "orders-by-hour", label: "Orders by hour", group: "truth", description: "How many orders landed in each hour of the day.", minRole: "MANAGER", windows: PERIOD_WINDOWS, defaultSize: "medium", href: "/analytics/hour-of-day" },
  { id: "top-products", label: "Top products", group: "truth", description: "The five best-selling products by quantity.", minRole: "MANAGER", windows: PERIOD_WINDOWS, defaultSize: "medium", href: "/products" },
  { id: "customer-mix", label: "New and returning customers", group: "truth", description: "New and returning customers, retention rate and RFM segments.", minRole: "MANAGER", windows: PERIOD_WINDOWS, defaultSize: "medium", href: "/analytics/rfm" },
  { id: "top-customers", label: "Top customers", group: "truth", description: "The five highest-spending customers and their points.", minRole: "MANAGER", windows: PERIOD_WINDOWS, defaultSize: "medium", href: "/customers" },
  { id: "stock-movement", label: "Stock movement", group: "truth", description: "Stock value, low and out-of-stock counts, and the fastest-moving products.", minRole: "MANAGER", windows: PERIOD_WINDOWS, defaultSize: "large", href: "/inventory" },
  { id: "busiest-hours", label: "Busiest Hours", group: "truth", description: "Average revenue by weekday and hour.", minRole: "MANAGER", windows: ["last12w", "last4w", "last26w"], defaultSize: "large", href: "/analytics/hour-of-day" },
  { id: "order-channels", label: "Order Channels", group: "truth", description: "Completed-order revenue by sales channel.", minRole: "MANAGER", windows: ["last90", "last30", "last180"], defaultSize: "medium", href: "/analytics/channels" },
  { id: "stock-turn", label: "Stock Turn", group: "truth", description: "Which categories sell fast and which sit, by days of stock.", minRole: "MANAGER", windows: ["last90", "last30", "last180"], defaultSize: "medium", href: "/analytics/stock-turn" },
  { id: "customer-truths", label: "Customer Truths", group: "truth", description: "How many customers sit in each RFM segment.", minRole: "MANAGER", windows: ["latest"], defaultSize: "medium", href: "/analytics/rfm" },
  // Whole-business profit: admins only, like the page and its API (FIX-03).
  { id: "profit-truths", label: "Profit Truths", group: "truth", description: "Revenue, cost of goods, gross and net profit.", minRole: "ADMIN", windows: ["month", "last30", "quarter", "year"], defaultSize: "medium", href: "/expense-reports" },
];

/** Evidence runs on the window its catalogue frequency implies. */
export function evidenceWindow(frequency: ReportCatalogEntry["frequency"]): TruthsWindow {
  switch (frequency) {
    case "DAILY":
      return "today";
    case "WEEKLY":
      return "last7";
    case "MONTHLY":
      return "last30";
    default:
      return "now";
  }
}

/** Planned Evidence has no view yet, so it cannot be a widget; the guide lists it as "coming". */
const EVIDENCE_WIDGETS: TruthsWidgetDef[] = REPORT_CATALOG.filter((r) => r.status === "available").map((r) => ({
  id: `evidence:${r.ref}`,
  label: r.title,
  group: "evidence",
  description: r.purpose,
  // The same line the server draws on GET /api/reports/:ref (Q12).
  minRole: evidenceRefMinRole(r.ref),
  windows: [evidenceWindow(r.frequency)],
  defaultSize: "medium",
  href: r.route,
  evidenceRef: r.ref,
}));

const GUIDE_WIDGET: TruthsWidgetDef = {
  id: "evidence-guide",
  label: "Evidence guide",
  group: "guide",
  description: "Every piece of Evidence and what it shows. Planned items are marked coming.",
  minRole: "MANAGER",
  windows: ["none"],
  defaultSize: "large",
  href: "/reports",
};

export const TRUTHS_WIDGETS: readonly TruthsWidgetDef[] = [...TRUTH_WIDGETS, ...EVIDENCE_WIDGETS, GUIDE_WIDGET];

const BY_ID = new Map(TRUTHS_WIDGETS.map((w) => [w.id, w]));

export function truthsWidget(id: string): TruthsWidgetDef | undefined {
  return BY_ID.get(id);
}

export type TruthsLayoutEntry = { id: string; size: WidgetSize; window: TruthsWindow };
export type TruthsLayout = TruthsLayoutEntry[];

function entry(id: string): TruthsLayoutEntry {
  const def = BY_ID.get(id)!;
  return { id, size: def.defaultSize, window: def.windows[0] };
}

/**
 * Used until an admin saves a layout: today's Truths Hub, chart for chart,
 * followed by the Evidence guide.
 */
export const DEFAULT_TRUTHS_LAYOUT: TruthsLayout = [
  "sales-summary",
  "revenue-by-day",
  "revenue-by-category",
  "payment-methods",
  "orders-by-hour",
  "top-products",
  "customer-mix",
  "top-customers",
  "stock-movement",
  "evidence-guide",
].map(entry);

export type LayoutParse = { ok: true; layout: TruthsLayout } | { ok: false; error: string };

/**
 * Checks a layout an admin wants to save. Anything the editor would not offer
 * is refused outright rather than quietly dropped, so what is saved is what
 * the admin saw.
 */
export function parseTruthsLayout(input: unknown): LayoutParse {
  if (!Array.isArray(input)) return { ok: false, error: "The layout must be a list of widgets." };
  if (input.length > TRUTHS_LAYOUT_MAX_WIDGETS) {
    return { ok: false, error: `A layout can hold at most ${TRUTHS_LAYOUT_MAX_WIDGETS} widgets.` };
  }
  const seen = new Set<string>();
  const layout: TruthsLayout = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "Each widget must be an object." };
    const { id, size, window } = raw as Record<string, unknown>;
    if (typeof id !== "string") return { ok: false, error: "Each widget needs an id." };
    const def = BY_ID.get(id);
    if (!def) return { ok: false, error: `Unknown widget: ${id.slice(0, 64)}` };
    if (seen.has(id)) return { ok: false, error: `${def.label} is in the layout twice.` };
    seen.add(id);
    const s = size ?? def.defaultSize;
    if (typeof s !== "string" || !(WIDGET_SIZES as readonly string[]).includes(s)) {
      return { ok: false, error: `${def.label}: size must be small, medium or large.` };
    }
    const w = window ?? def.windows[0];
    if (typeof w !== "string" || !(def.windows as readonly string[]).includes(w)) {
      return { ok: false, error: `${def.label} cannot use that window.` };
    }
    layout.push({ id, size: s as WidgetSize, window: w as TruthsWindow });
  }
  return { ok: true, layout };
}

/**
 * The layout as a given viewer sees it: widgets their role may not see are
 * left out entirely (not shown locked), and anything no longer in the
 * catalogue — a widget retired since the layout was saved — is dropped.
 */
export function truthsLayoutForRole(layout: TruthsLayout, role: string | null | undefined): TruthsLayout {
  return layout.filter((e) => {
    const def = BY_ID.get(e.id);
    return !!def && isAtLeast(role, def.minRole);
  });
}

/** Widgets the admin's add-widget dropdown offers: those not already placed. */
export function addableWidgets(layout: TruthsLayout): TruthsWidgetDef[] {
  const placed = new Set(layout.map((e) => e.id));
  return TRUTHS_WIDGETS.filter((w) => !placed.has(w.id));
}

/**
 * The date range a period window covers, relative to `now`. Windows counted
 * in days or weeks are passed to their API as a count instead
 * (`windowDays`, `windowWeeks`); "now", "latest" and "none" have no range.
 */
export function windowRange(window: TruthsWindow, now: Date = new Date()): { from: Date; to: Date } | null {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  const daysBack = (n: number) => {
    const d = startOfDay(now);
    d.setDate(d.getDate() - (n - 1));
    return d;
  };
  switch (window) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "week": {
      // Monday-start week (UK trading week).
      const from = startOfDay(now);
      from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
      const to = new Date(from);
      to.setDate(to.getDate() + 6);
      return { from, to: endOfDay(to) };
    }
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3);
      return { from: new Date(now.getFullYear(), q * 3, 1), to: endOfDay(new Date(now.getFullYear(), q * 3 + 3, 0)) };
    }
    case "year":
      return { from: new Date(now.getFullYear(), 0, 1), to: endOfDay(new Date(now.getFullYear(), 11, 31)) };
    case "last7":
    case "last30":
    case "last90":
    case "last180":
      return { from: daysBack(windowDays(window)!), to: endOfDay(now) };
    default:
      return null;
  }
}

export function windowDays(window: TruthsWindow): number | null {
  const m = /^last(\d+)$/.exec(window);
  return m ? Number(m[1]) : null;
}

export function windowWeeks(window: TruthsWindow): number | null {
  const m = /^last(\d+)w$/.exec(window);
  return m ? Number(m[1]) : null;
}
