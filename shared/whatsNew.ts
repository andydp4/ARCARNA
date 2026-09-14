import { APP_VERSION } from "./version";

export type WhatsNewRole = "CASHIER" | "MANAGER" | "ADMIN" | "SUPER_ADMIN";

export interface WhatsNewItem {
  /** Which role(s) this item is actually relevant to seeing on first login. */
  roles: WhatsNewRole[];
  /** Where in the app this shows up, for the "go look at X" signpost. */
  area: string;
  title: string;
  detail: string;
}

/**
 * v1.1 release notes, grouped by relevance rather than by PR — a cashier
 * doesn't need to hear about report definitions, a manager doesn't need the
 * POS shift-status line explained twice. Keep this list append-only per
 * release; WhatsNewModal filters it by APP_VERSION and viewer role.
 */
export const WHATS_NEW: Record<string, WhatsNewItem[]> = {
  "1.1.0": [
    {
      roles: ["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "POS",
      title: "See your own shift on the till screen",
      detail:
        "A \"My shift so far\" line now shows your hours, sales and commission live while you work — no need to check Cashier Payroll mid-shift.",
    },
    {
      roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Shifts",
      title: "Close or reopen anyone's drawer from here",
      detail:
        "The Shifts page now has a \"⋮\" menu on every row — close an uncounted drawer or reopen a closed one directly, instead of it just sitting flagged with no way to act on it.",
    },
    {
      roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Cashier Payroll",
      title: "\"Confirm paid\" works for every shift now",
      detail:
        "Commission on shifts opened without a cashier code used to 400 forever on \"Confirm paid\". Fixed — payroll now resolves the right person automatically.",
    },
    {
      roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Reports",
      title: "One consistent definition of \"revenue\" everywhere",
      detail:
        "Daily Sales, Weekly Sales, Weekly Margin, Satisfaction, Staff KPI, Insights and Profit Truths all now use the same settled-orders-net-of-refunds figure Control Centre already used. Numbers on these pages will look different — that's the fix, not a bug. Every report now states its definition inline.",
    },
    {
      roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Reports",
      title: "Filter any report by location or cashier",
      detail:
        "Daily Sales, Weekly Sales, Current Stock, Weekly Margin and Stock Runway all have a new location/cashier filter — see one site's or one person's numbers instead of only the org-wide total.",
    },
    {
      roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Reports",
      title: "Churn Risk and the Truths hub use real numbers now",
      detail:
        "A customer's first order no longer flags them as \"at risk\" the next day. The Truths hub's category breakdown, customer segments and stock turnover are now real queries instead of placeholders.",
    },
    {
      roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Purchasing",
      title: "Export a real purchase order document",
      detail:
        "Approved purchase drafts can now export a proper PDF with supplier details, reference number and line items — not just a bare CSV.",
    },
    {
      roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Inventory",
      title: "View stock at any location, not just your own",
      detail:
        "Stock levels now has a location selector — check another site's stock, or the org-wide total, without switching your own context.",
    },
    {
      roles: ["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Everywhere",
      title: "Tables and charts now work properly on a phone",
      detail:
        "Shifts, Invoices, Cashier Payroll and every report page now show a card layout on narrow screens instead of a table you have to scroll sideways to use.",
    },
    {
      roles: ["ADMIN", "SUPER_ADMIN"],
      area: "System Activity / Developer settings",
      title: "A few display bugs fixed",
      detail:
        "Job Queue rows no longer collide with duplicate keys, and both pages no longer scroll sideways on a phone.",
    },
  ],
};

export function whatsNewForRole(version: string, role: string): WhatsNewItem[] {
  const items = WHATS_NEW[version] ?? [];
  return items.filter((item) => item.roles.includes(role as WhatsNewRole));
}

export const LATEST_WHATS_NEW_VERSION = APP_VERSION;
