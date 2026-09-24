import type { LucideIcon } from 'lucide-react'
import {
  Package,
  Users,
  TrendingUp,
  Wallet,
  PieChart,
  Gift,
  MapPin,
  FileText,
  Home,
  Award,
  Boxes,
  Settings,
  CreditCard,
  LayoutGrid,
  Shield,
  CalendarClock,
  Timer,
  Ticket,
  Clock,
  Radio,
  Layers,
  Code2,
  FileBarChart,
  Handshake,
  ClipboardList,
  ScrollText,
  Activity,
  Workflow,
  AlertTriangle,
  Truck,
  Eye,
} from 'lucide-react'
import type { Role } from '@shared/rbac'
import { VOCAB } from '@/lib/vocabulary'

/** Roles allowed to see admin-only nav entries (Route Experience Spec §10). */
const ADMIN_ROLES: readonly Role[] = ['SUPER_ADMIN', 'ADMIN']

/**
 * Roles allowed to see MANAGER-and-up nav entries — day-to-day operational
 * tools the server already lets a manager touch (see the `requireRole(...)`
 * calls each of these routes) but that have no place on a cashier's menu
 * (owner direction, ARC-007/009): "cashiers should have a very clean simple
 * area, managers have some of the analytics but not business wide functions."
 */
const MANAGER_ROLES: readonly Role[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER']

/** Roles allowed to see SUPER_ADMIN-only nav entries. */
const SUPER_ADMIN_ONLY: readonly Role[] = ['SUPER_ADMIN']

/** Menu-only: entries that exist for a cashier because they lack the manager's fuller page. */
const CASHIER_ONLY: readonly Role[] = ['CASHIER']

/**
 * The Settings page's tabs, listed under it in the Settings Centre menu. Role
 * lines match `pages/settings.tsx` (Imports, Cashiers and Operations are
 * manager and above; Flags admin and above). Suppliers moved to the Stock Centre.
 */
export const SETTINGS_TABS: readonly NavTab[] = [
  { key: 'general', label: 'General', tab: 'general', testId: 'nav-settings-tab-general' },
  { key: 'imports', label: 'Imports', tab: 'imports', testId: 'nav-settings-tab-imports', roles: MANAGER_ROLES },
  { key: 'payment', label: 'Payment', tab: 'payment', testId: 'nav-settings-tab-payment' },
  { key: 'invoice', label: 'Invoice', tab: 'invoice', testId: 'nav-settings-tab-invoice' },
  { key: 'system', label: 'System', tab: 'system', testId: 'nav-settings-tab-system' },
  { key: 'integrations', label: 'Integrations', tab: 'integrations', testId: 'nav-settings-tab-integrations' },
  { key: 'cashiers', label: 'Cashiers', tab: 'cashiers', testId: 'nav-settings-tab-cashiers', roles: MANAGER_ROLES },
  { key: 'operations', label: 'Operations', tab: 'operations', testId: 'nav-settings-tab-operations', roles: MANAGER_ROLES },
  { key: 'users', label: 'Users', tab: 'users', testId: 'nav-settings-tab-users' },
  { key: 'flags', label: 'Flags', tab: 'flags', testId: 'nav-settings-tab-flags', roles: ADMIN_ROLES },
]

export interface NavItem {
  key: string
  label: string
  href: string
  icon: LucideIcon
  testId: string
  /** When set, only these roles may open the route (and see it in the menu). Undefined = everyone. */
  roles?: readonly Role[]
  /**
   * When set, only these roles see the item in the menu — narrower than who may
   * open it. Stock levels is the case: any member of staff may open it, but a
   * manager already has Products and Stock Truths, so only a cashier is shown it.
   */
  menuRoles?: readonly Role[]
  /** Sub-menu entries that are tabs of this page (`?tab=`), shown beneath it. */
  tabs?: readonly NavTab[]
}

/** A tab of a page, listed in the menu under that page. */
export interface NavTab {
  key: string
  label: string
  /** The page's `?tab=` value. */
  tab: string
  testId: string
  roles?: readonly Role[]
}

/**
 * A Centre (v1.2 Phase 3): the main menu lists the seven Centres; choosing one
 * opens its first page the viewer may see (its landing page) and switches the
 * menu to that Centre's pages. The Centre's label is also the eyebrow on every
 * page inside it (`PageHeader`).
 */
export interface NavGroup {
  key: CentreKey
  label: string
  testId: string
  icon: LucideIcon
  /** In menu order. The first one the viewer can see is the Centre's landing page. */
  items: NavItem[]
  /**
   * Routes inside this Centre that are not menu items (a report page, a
   * refund, a promotion's lift) — matched by prefix, so a deep link to one
   * still opens the right Centre.
   */
  pathPrefixes?: readonly string[]
}

export type CentreKey = 'control' | 'operations' | 'stock' | 'truths' | 'customer' | 'finance' | 'settings'
export type Centre = NavGroup

/**
 * Navigation information architecture — source of truth for sidebar copy.
 *
 * v1.2 Phase 3 reorganised the six groups (Control Centre · Sell · Stock ·
 * Understand · Operate · Administer) into the seven Centres signed off in the
 * v1.2 brief. Labels still follow the owner-approved "Truths" lexicon in
 * `vocabulary.ts`. Role lists are unchanged by the move: who may open a page
 * is the same as before; only where it sits in the menu changed.
 */
export const centres: Centre[] = [
  {
    key: 'control',
    label: VOCAB.controlCentre,
    testId: 'nav-centre-control',
    icon: Home,
    items: [
      {
        key: 'home',
        label: VOCAB.controlCentre,
        href: '/',
        icon: Home,
        testId: 'nav-home'
      }
    ]
  },
  {
    key: 'operations',
    label: 'Operations Centre',
    testId: 'nav-centre-operations',
    icon: LayoutGrid,
    // New order is merged into the board (/create-order and /pos redirect to
    // its New order pane), so it has no menu entry of its own any more.
    pathPrefixes: ['/open-orders/', '/orders/'],
    items: [
      {
        // The testid is kept so the one nav entry for "where orders are
        // worked" has one name across the suites that already assert on it.
        key: 'orders',
        label: 'Operations board',
        href: '/operations',
        icon: LayoutGrid,
        testId: 'nav-orders'
      },
      {
        // Owner decision Q11: invoices and the Credit List are manager and
        // above, here and on the server. Cashiers lose both.
        key: 'tick-list',
        label: 'Credit List',
        href: '/tick-list',
        icon: CreditCard,
        testId: 'nav-tick-list',
        roles: MANAGER_ROLES
      },
      {
        // Till sales the server refused (v1.2 Phase 1A). Managers retry,
        // edit, export or discard them; the server enforces the same line.
        key: 'needs-attention',
        label: 'Needs attention',
        href: '/needs-attention',
        icon: AlertTriangle,
        testId: 'nav-needs-attention',
        roles: MANAGER_ROLES
      },
      {
        // Exceptions to review (v1.2 Phase 4, CMP-02): flagged sales and
        // refunds. Each person gets only the queues below their own role;
        // the server cuts the rows the same way.
        key: 'needs-a-look',
        label: 'Needs a look',
        href: '/needs-a-look',
        icon: ClipboardList,
        testId: 'nav-needs-a-look',
        roles: MANAGER_ROLES
      }
    ]
  },
  {
    key: 'stock',
    label: 'Stock Centre',
    testId: 'nav-centre-stock',
    icon: Package,
    items: [
      {
        key: 'products',
        label: 'Products',
        href: '/products',
        icon: Package,
        testId: 'nav-products',
        roles: MANAGER_ROLES
      },
      {
        // The cashier's read-only view: counts only, never a cost (the route
        // answers from an allow-list, server/routes/inventory.ts).
        key: 'stock-levels',
        label: 'Stock levels',
        href: '/stock-levels',
        icon: Boxes,
        testId: 'nav-stock-levels',
        menuRoles: CASHIER_ONLY
      },
      {
        key: 'inventory',
        label: VOCAB.stockTruths,
        href: '/inventory',
        icon: Boxes,
        testId: 'nav-inventory',
        roles: MANAGER_ROLES
      },
      {
        key: 'purchase-drafts',
        label: 'Purchase Drafts',
        href: '/purchase-drafts',
        icon: ClipboardList,
        testId: 'nav-purchase-drafts',
        roles: MANAGER_ROLES
      },
      {
        // Moved out of the Settings tabs. Supplier records carry cost prices,
        // which the server keeps to managers and above (Q6).
        key: 'suppliers',
        label: 'Suppliers',
        href: '/suppliers',
        icon: Truck,
        testId: 'nav-suppliers',
        roles: MANAGER_ROLES
      }
    ]
  },
  {
    key: 'truths',
    label: 'Truths Centre',
    testId: 'nav-centre-truths',
    icon: TrendingUp,
    pathPrefixes: ['/reports/', '/analytics/'],
    items: [
      {
        // The Centre's landing page: the org's widget layout, set by admins.
        key: 'truths-at-a-glance',
        label: VOCAB.truthsAtAGlance,
        href: '/truths',
        icon: TrendingUp,
        testId: 'nav-truths-at-a-glance',
        roles: MANAGER_ROLES
      },
      {
        // The Evidence hub (formerly "Reports", renamed for the brand
        // vocabulary: Q20b). Every Evidence read behind it is manager and
        // above on the server (shared/accessPolicy.ts), and the refs above
        // the manager line (Q12) are refused there too.
        key: 'reports-hub',
        label: 'Evidence',
        href: '/reports',
        icon: FileBarChart,
        testId: 'nav-reports-hub',
        roles: MANAGER_ROLES
      },
      {
        key: 'rfm',
        label: VOCAB.customerTruths,
        href: '/analytics/rfm',
        icon: PieChart,
        testId: 'nav-rfm',
        roles: MANAGER_ROLES
      },
      {
        key: 'hour-of-day',
        label: 'Busiest Hours',
        href: '/analytics/hour-of-day',
        icon: Clock,
        testId: 'nav-hour-of-day',
        roles: MANAGER_ROLES
      },
      {
        key: 'channels',
        label: 'Order Channels',
        href: '/analytics/channels',
        icon: Radio,
        testId: 'nav-channels',
        roles: MANAGER_ROLES
      },
      {
        key: 'stock-turn',
        label: 'Stock Turn',
        href: '/analytics/stock-turn',
        icon: Layers,
        testId: 'nav-stock-turn',
        roles: MANAGER_ROLES
      },
      {
        // Whole-business profit/loss — explicitly the owner's "business wide"
        // example of what a manager should NOT get by default (ARC-007/009).
        // The server refuses its reads below ADMIN too (server/routes/expenses.ts).
        key: 'profit',
        label: VOCAB.profitTruths,
        href: '/expense-reports',
        icon: PieChart,
        testId: 'nav-profit',
        roles: ADMIN_ROLES
      },
      {
        // Phase 2's silent recording: every sale below cost or minimum while
        // the till shows no warning yet (owner Q3). Admins and the owner only
        // — managers must not be able to review flags about themselves.
        key: 'would-have-flagged',
        label: 'Would have flagged',
        href: '/reports/would-have-flagged',
        icon: AlertTriangle,
        testId: 'nav-would-have-flagged',
        roles: ADMIN_ROLES
      },
      {
        // Price overrides (v1.2 Phase 4, PRC-09): by cashier, product and
        // reason. Managers see cashiers', admins managers' too (server-cut).
        key: 'price-overrides',
        label: 'Price overrides',
        href: '/reports/price-overrides',
        icon: AlertTriangle,
        testId: 'nav-price-overrides',
        roles: MANAGER_ROLES
      },
      {
        key: 'scheduled-reports',
        label: 'Scheduled Evidence',
        href: '/scheduled-reports',
        icon: CalendarClock,
        testId: 'nav-scheduled-reports',
        roles: MANAGER_ROLES
      }
    ]
  },
  {
    // Managers and above. Ticks and gift cards are sold inline at the till
    // already (pos.tsx), and the till's own customer picker does not go
    // through these pages. The cashier's customer lookup lands in Phase 5.
    key: 'customer',
    label: 'Customer Centre',
    testId: 'nav-centre-customer',
    icon: Users,
    pathPrefixes: ['/promotions/'],
    items: [
      {
        key: 'customers',
        label: 'Customers',
        href: '/customers',
        icon: Users,
        testId: 'nav-customers',
        roles: MANAGER_ROLES
      },
      {
        key: 'loyalty',
        label: 'Loyalty',
        href: '/loyalty',
        icon: Award,
        testId: 'nav-loyalty',
        roles: MANAGER_ROLES
      },
      {
        key: 'promotions',
        label: 'Promotions',
        href: '/promotions',
        icon: Gift,
        testId: 'nav-promotions',
        roles: MANAGER_ROLES
      },
      {
        key: 'gift-cards',
        label: 'Gift Cards',
        href: '/gift-cards',
        icon: Ticket,
        testId: 'nav-gift-cards',
        roles: MANAGER_ROLES
      }
    ]
  },
  {
    key: 'finance',
    label: 'Finance Centre',
    testId: 'nav-centre-finance',
    icon: Wallet,
    items: [
      {
        // Everyone; a cashier's list holds only their own shifts — the server
        // filters the rows (server/routes/shifts.ts, maySeeShiftSheet).
        key: 'shifts',
        label: 'Shifts',
        href: '/shifts',
        icon: Timer,
        testId: 'nav-shifts'
      },
      {
        key: 'expenses',
        label: 'Expenses',
        href: '/expenses',
        icon: Wallet,
        testId: 'nav-expenses',
        roles: MANAGER_ROLES
      },
      {
        key: 'reseller-partners',
        label: 'Reseller Partners',
        href: '/reseller-partners',
        icon: Handshake,
        testId: 'nav-reseller-partners',
        roles: MANAGER_ROLES
      },
      {
        // A manager's own team's payroll, not a company-wide payroll config —
        // server/routes/cashierAnalytics.ts already restricts this to
        // MANAGER and up.
        key: 'cashier-payroll',
        label: 'Cashier Payroll',
        href: '/cashier-payroll',
        icon: Wallet,
        testId: 'nav-cashier-payroll',
        roles: MANAGER_ROLES
      },
      {
        key: 'invoices',
        label: 'Invoices',
        href: '/invoices',
        icon: FileText,
        testId: 'nav-invoices',
        roles: MANAGER_ROLES
      }
    ]
  },
  {
    key: 'settings',
    label: 'Settings Centre',
    testId: 'nav-centre-settings',
    icon: Settings,
    pathPrefixes: ['/settings/', '/admin/'],
    items: [
      {
        key: 'settings',
        label: 'Settings',
        href: '/settings',
        icon: Settings,
        testId: 'nav-settings',
        // Mirrors the tab list in pages/settings.tsx — same role lines.
        tabs: SETTINGS_TABS
      },
      {
        key: 'user-access',
        label: 'User Access',
        href: '/user-access',
        icon: Shield,
        testId: 'nav-user-access',
        roles: ADMIN_ROLES
      },
      {
        // Moved from Operate. Every location CRUD route is SUPER_ADMIN/ADMIN
        // only (server/routes/locations.ts), so the page is admin-only even
        // though the plain location list is readable by POS staff.
        key: 'locations',
        label: 'Locations',
        href: '/locations',
        icon: MapPin,
        testId: 'nav-locations',
        roles: ADMIN_ROLES
      },
      {
        // server/routes/automation.ts permits MANAGER on every rules route.
        key: 'rules',
        label: 'Rules',
        href: '/rules',
        icon: Workflow,
        testId: 'nav-rules',
        roles: MANAGER_ROLES
      },
      {
        // pages/settings/developer.tsx itself only renders for ADMIN/SUPER_ADMIN.
        key: 'developer',
        label: 'Developer',
        href: '/settings/developer',
        icon: Code2,
        testId: 'nav-developer',
        roles: ADMIN_ROLES
      },
      {
        // pages/audit-logs.tsx self-gates to SUPER_ADMIN only.
        key: 'audit-logs',
        label: 'Audit Log',
        href: '/audit-logs',
        icon: ScrollText,
        testId: 'nav-audit-logs',
        roles: SUPER_ADMIN_ONLY
      },
      {
        // The org-wide customer data access log (v1.2 Phase 6, PRV-10): the
        // owner's page only (Q13a); admins see each customer's Access history.
        key: 'customer-access-log',
        label: 'Customer data access',
        href: '/customer-access-log',
        icon: Eye,
        testId: 'nav-customer-access-log',
        roles: SUPER_ADMIN_ONLY
      },
      {
        // server/routes/workers.ts requires SUPER_ADMIN (plus MFA).
        key: 'worker-logs',
        label: 'System Activity',
        href: '/worker-logs',
        icon: Activity,
        testId: 'nav-worker-logs',
        roles: SUPER_ADMIN_ONLY
      }
    ]
  }
]

/** Back-compat name: the Centres are the menu's groups. */
export const navGroups: NavGroup[] = centres

/** Flat list of every nav item, in menu order. */
export const navItems: NavItem[] = centres.flatMap((centre) => centre.items)

function roleAllowed(roles: readonly Role[] | undefined, role: string | null | undefined): boolean {
  if (!roles) return true
  return roles.some((allowed) => allowed === role)
}

/** Whether this viewer sees the item in the menu. */
export function isNavItemVisible(item: NavItem, role: string | null | undefined): boolean {
  return roleAllowed(item.roles, role) && roleAllowed(item.menuRoles, role)
}

/** The tabs of a menu item this viewer may see. */
export function visibleTabs(item: NavItem, role: string | null | undefined): NavTab[] {
  return (item.tabs ?? []).filter((tab) => roleAllowed(tab.roles, role))
}

/** Centres with at least one page this viewer sees, each holding only those pages. */
export function visibleCentres(role: string | null | undefined): Centre[] {
  return centres
    .map((centre) => ({ ...centre, items: centre.items.filter((item) => isNavItemVisible(item, role)) }))
    .filter((centre) => centre.items.length > 0)
}

/** Where choosing a Centre takes this viewer: its first page they can see. */
export function centreLandingHref(centreKey: CentreKey, role: string | null | undefined): string | undefined {
  return visibleCentres(role).find((centre) => centre.key === centreKey)?.items[0]?.href
}

/**
 * The Centre a path belongs to — what a deep link opens and what the page
 * eyebrow says. An exact menu match wins; otherwise the longest matching
 * sub-path (a report under /reports/, a refund under /open-orders/).
 */
export function centreForPath(path: string): Centre | undefined {
  const clean = (path.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/'
  const exact = centres.find((centre) => centre.items.some((item) => item.href === clean))
  if (exact) return exact
  let best: { centre: Centre; length: number } | undefined
  for (const centre of centres) {
    const prefixes = [
      ...(centre.pathPrefixes ?? []),
      ...centre.items.filter((item) => item.href !== '/').map((item) => `${item.href}/`),
    ]
    for (const prefix of prefixes) {
      if (clean.startsWith(prefix) && (!best || prefix.length > best.length)) {
        best = { centre, length: prefix.length }
      }
    }
  }
  return best?.centre
}

/**
 * The nav group a route belongs to — the eyebrow for that route's `PageHeader`.
 * Returns undefined for routes that are in no Centre.
 */
export function navGroupLabelForHref(href: string): string | undefined {
  return centreForPath(href)?.label
}

/**
 * A handful of routes are reached only via a link inside another page (not
 * the sidebar), so they have no `NavItem` of their own — but a role that
 * lacks server-side write access to them should still see the same honest
 * "no access" state on a direct URL visit, not a working form that fails on
 * save. Kept here, next to the nav items themselves, so `App.tsx`'s route
 * gating and this file never drift into two separately hand-maintained role
 * lists (ARC-008).
 */
const EXTRA_ROUTE_ROLES: Record<string, readonly Role[]> = {
  // server/routes/receipts.ts: PUT /api/receipts/settings requires MANAGER+.
  '/settings/receipts': MANAGER_ROLES,
  // server/routes/loyalty.ts: PUT /api/loyalty/settings requires MANAGER+.
  '/settings/loyalty': MANAGER_ROLES,
  // Reached only from a link on the (MANAGER+-gated) Promotions page.
  '/promotions/:id/lift': MANAGER_ROLES,
  // Shop website settings: server/routes/website.ts requireWebsiteStaffRole is
  // MANAGER+ for every read and write, so a cashier only ever saw a broken page.
  '/settings/wm-supplies-website': MANAGER_ROLES,
  '/admin/wm-supplies/website': MANAGER_ROLES,
}

/**
 * The roles allowed to view the route at this `href` — from its nav item if
 * it has one, otherwise from {@link EXTRA_ROUTE_ROLES}. `undefined` means the
 * route is open to every signed-in org role.
 */
export function rolesForHref(href: string): readonly Role[] | undefined {
  const navItem = navItems.find((item) => item.href === href)
  if (navItem) return navItem.roles
  return EXTRA_ROUTE_ROLES[href]
}

/**
 * The Centre whose tour this viewer should get on this path, if any: only a
 * Centre they can see, and only on a page they may open. A cashier on an old
 * Truths bookmark lands on "no access" — touring a Centre they cannot open
 * there (and marking it seen for their account) would be wrong twice over.
 */
export function centreTourKeyForPath(path: string, role: string | null | undefined): CentreKey | undefined {
  const centre = centreForPath(path)
  if (!centre) return undefined
  if (!visibleCentres(role).some((visible) => visible.key === centre.key)) return undefined
  const clean = (path.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/'
  if (!roleAllowed(rolesForHref(clean), role)) return undefined
  return centre.key
}
