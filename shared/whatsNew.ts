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
  // v1.2: kept short; the full notes are docs/RELEASE_NOTES_1.2.md. Each new
  // page also has its own one-time tour (client/src/components/tour/featureTours.ts).
  "1.2.0": [
    {
      roles: ["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Menu",
      title: "arcarna is arranged into Centres",
      detail:
        "The menu lists the Centres; pick one to see its pages, and \"← Main menu\" to go back. On a computer it opens when you point at it; the pin keeps it open. Replay tour shows any tour again.",
    },
    {
      roles: ["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Operations Centre › My run",
      title: "My run: your deliveries on your phone",
      detail:
        "Your stops in your order, with Navigate, Start run, Delivered and Couldn't deliver. Taps made with no signal are kept on the phone and sent when you are back online.",
    },
    {
      roles: ["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Till",
      title: "Card (link): the customer pays on their own phone",
      detail:
        "Once Stripe is set up, choose Card (link) at Pay: a QR code for the exact amount, and the sale marks itself paid when Stripe confirms. Until then the board shows \"Awaiting card payment\".",
    },
    {
      roles: ["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Labels",
      title: "Print labels on a Niimbot B1",
      detail:
        "Pair the printer in Settings › System, then use Print label on an order's details on the board (and on products, for managers). It needs Chrome on a computer, or the Bluefy app on an iPhone.",
    },
    {
      roles: ["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Till",
      title: "Every sale recorded once, offline too",
      detail:
        "A sale made with no connection is kept and sent later; the offline line says how many are waiting or failed. You cannot sign out while sales are still unsent.",
    },
    {
      roles: ["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Everywhere",
      title: "Problem? button",
      detail:
        "Stuck, slow, or seeing an error? Press Problem? in the header or on the till and pick what happened. Please don't type customer details.",
    },
    {
      roles: ["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Operations Centre › My performance",
      title: "My performance",
      detail: "Your own figures, commission, targets and badges. Nobody else's are shown, and there is no ranking.",
    },
    {
      roles: ["CASHIER"],
      area: "Customers",
      title: "Customer details stay private",
      detail:
        "You see a customer's name, tier and points; phone and email are masked (••4821). A delivery's address shows while the order is live. Credit List and Invoices are for managers now.",
    },
    {
      roles: ["CASHIER"],
      area: "Stock Centre › Stock levels",
      title: "Stock levels",
      detail: "How many of each product your location has on the shelf. Read-only.",
    },
    {
      roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Operations Centre › Needs a look",
      title: "Needs a look",
      detail:
        "Sales below the minimum or below cost, refunds the rules pick out, weekly patterns and contact-details requests, each to be marked acknowledged, explained or escalated. Nothing is blocked.",
    },
    {
      roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Evidence",
      title: "Staff Performance and Order Timing",
      detail:
        "Staff Performance replaces Staff KPI and adds up to the sales you took; Order Timing shows how fast orders move and where they wait. Per-person figures are marked provisional at first.",
    },
    {
      roles: ["MANAGER"],
      area: "Customers",
      title: "Contact details: message first, or ask",
      detail:
        "Phone and email are masked for managers. Contact › Message the customer instead sends an approved WhatsApp message without showing the number; if you need the details, request them with a reason and an admin can approve 24 hours.",
    },
    {
      roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Products",
      title: "Minimum price and price history",
      detail:
        "Each product can have a lowest price (it follows the sale price until you set one). Price history shows every sale, minimum and cost change, and Set minimum price changes many at once.",
    },
    {
      roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"],
      area: "Truths Centre",
      title: "Truths at a glance, and Reports are now Evidence",
      detail:
        "The Truths Centre opens on Truths at a glance: the widgets an admin chose, each stating its window. Every report is under Evidence.",
    },
    {
      roles: ["ADMIN", "SUPER_ADMIN"],
      area: "Needs a look / Customers",
      title: "Approve contact-details requests",
      detail:
        "Managers' requests arrive as a Signal and in Needs a look: Approve for 24 hours, Decline, or revoke later. Each customer's Contact shows their Access history.",
    },
    {
      roles: ["ADMIN", "SUPER_ADMIN"],
      area: "Settings › General",
      title: "Price guard at the till starts off",
      detail:
        "While it is off, underpriced sales are recorded silently for Would have flagged. Turn it on to show cashiers one amber line and ask for a reason at Pay. Signals and refund rules are set beside it.",
    },
    {
      roles: ["ADMIN", "SUPER_ADMIN"],
      area: "Settings",
      title: "Things to set up",
      detail:
        "Card (link) needs Stripe keys on the server (Settings › Payment shows the lines). WhatsApp messages need their templates approved by Meta. Staff targets are set by admins.",
    },
    {
      roles: ["ADMIN", "SUPER_ADMIN"],
      area: "Truths Centre",
      title: "Problem? inbox",
      detail: "What staff reported with Problem?, with the screen and device. Mark one fixed and the reporter is told.",
    },
    {
      roles: ["SUPER_ADMIN"],
      area: "Settings Centre / Truths Centre",
      title: "Customer data access and Friction Truths",
      detail:
        "Customer data access lists every look at customers' contact details across the shop. Friction Truths shows where staff get stuck, by role, never by name.",
    },
  ],
};

export function whatsNewForRole(version: string, role: string): WhatsNewItem[] {
  const items = WHATS_NEW[version] ?? [];
  return items.filter((item) => item.roles.includes(role as WhatsNewRole));
}

export const LATEST_WHATS_NEW_VERSION = APP_VERSION;
