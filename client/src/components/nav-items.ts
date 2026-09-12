import type { LucideIcon } from 'lucide-react'
import {
  ShoppingCart,
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
  PackageCheck,
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

export interface NavItem {
  key: string
  label: string
  href: string
  icon: LucideIcon
  testId: string
  /** When set, only these roles see the item. Undefined = visible to everyone. */
  roles?: readonly Role[]
}

/**
 * A sidebar section. The six groups are fixed by
 * `docs/specs/ARCARNA_LANGUAGE_SPECIFICATION.md` §3 and the Route Experience
 * Spec §1: Control Centre · Sell · Stock · Understand · Operate · Administer.
 * The group label is also the eyebrow used by each route's `PageHeader`.
 */
export interface NavGroup {
  key: string
  label: string
  testId: string
  items: NavItem[]
}

/**
 * Navigation information architecture — source of truth for sidebar copy.
 *
 * GROUPING follows the Language Specification §3 (six groups). LABELS follow
 * the owner-approved "Truths" lexicon in `vocabulary.ts`, which POSTDATES that
 * spec table — §3 still lists the pre-rebrand names (its "current label" column
 * says `/inventory` is "Inventory", but the app has shipped "Stock Truths").
 * Where the two disagree, the Truths lexicon wins. Routes are unchanged.
 */
export const navGroups: NavGroup[] = [
  {
    key: 'control-centre',
    label: VOCAB.controlCentre,
    testId: 'nav-group-control-centre',
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
    key: 'sell',
    label: 'Sell',
    testId: 'nav-group-sell',
    items: [
      {
        key: 'pos',
        label: VOCAB.createOrder,
        href: '/create-order',
        icon: ShoppingCart,
        testId: 'nav-pos'
      },
      {
        key: 'orders',
        label: VOCAB.openOrders,
        href: '/open-orders',
        icon: PackageCheck,
        testId: 'nav-orders'
      },
      {
        key: 'shifts',
        label: 'Shifts',
        href: '/shifts',
        icon: Timer,
        testId: 'nav-shifts'
      },
      {
        key: 'invoices',
        label: 'Invoices',
        href: '/invoices',
        icon: FileText,
        testId: 'nav-invoices'
      },
      {
        key: 'tick-list',
        label: 'Credit List',
        href: '/tick-list',
        icon: CreditCard,
        testId: 'nav-tick-list'
      }
    ]
  },
  {
    key: 'stock',
    label: 'Stock',
    testId: 'nav-group-stock',
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
      }
    ]
  },
  {
    key: 'understand',
    label: 'Understand',
    testId: 'nav-group-understand',
    items: [
      {
        key: 'insights',
        label: VOCAB.truthsHub,
        href: '/insights',
        icon: TrendingUp,
        testId: 'nav-insights',
        roles: MANAGER_ROLES
      },
      {
        // Reports Hub links out to every individual report page
        // (server/routes/reports.ts and reports/index.tsx, both outside this
        // change's scope, apply no further per-report role check), so gating
        // this one entry is the whole story for what a manager can reach
        // through it — see the PR description for the judgment call this
        // implies about business-wide report pages reachable from here.
        key: 'reports-hub',
        label: 'Reports',
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
        // Nothing server-side (server/routes/expenses.ts) role-gates this
        // today, so this is a nav-level tightening ahead of that.
        key: 'profit',
        label: VOCAB.profitTruths,
        href: '/expense-reports',
        icon: PieChart,
        testId: 'nav-profit',
        roles: ADMIN_ROLES
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
    // None of this group is on a cashier's menu (owner direction, ARC-007/009):
    // ticks and gift cards are sold inline at the till already (pos.tsx), so
    // the standalone management pages here are for staff who administer the
    // program, not staff who redeem it during a sale.
    key: 'operate',
    label: 'Operate',
    testId: 'nav-group-operate',
    items: [
      {
        // The POS's own inline customer picker (used for tick sales at the
        // till) does not go through this page, so hiding it from cashiers
        // does not take anything away from a till transaction — see PR
        // description for this call.
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
      },
      {
        // Every location CRUD route is SUPER_ADMIN/ADMIN only
        // (server/routes/locations.ts), so the page is admin-only even though
        // the plain location list is readable by POS staff for shift opening.
        key: 'locations',
        label: 'Locations',
        href: '/locations',
        icon: MapPin,
        testId: 'nav-locations',
        roles: ADMIN_ROLES
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
      }
    ]
  },
  {
    key: 'administer',
    label: 'Administer',
    testId: 'nav-group-administer',
    items: [
      {
        key: 'settings',
        label: 'Settings',
        href: '/settings',
        icon: Settings,
        testId: 'nav-settings'
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
        // pages/settings/developer.tsx itself only renders for ADMIN/SUPER_ADMIN
        // (`canAccess`); this item had no role restriction at all before, so
        // every role saw a link to a page that then refused everyone else.
        key: 'developer',
        label: 'Developer',
        href: '/settings/developer',
        icon: Code2,
        testId: 'nav-developer',
        roles: ADMIN_ROLES
      },
      {
        // pages/audit-logs.tsx self-gates to SUPER_ADMIN only; this was
        // previously shown to ADMIN too, who would open it and immediately
        // hit its "Restricted" state.
        key: 'audit-logs',
        label: 'Audit Log',
        href: '/audit-logs',
        icon: ScrollText,
        testId: 'nav-audit-logs',
        roles: SUPER_ADMIN_ONLY
      },
      {
        // server/routes/workers.ts requires SUPER_ADMIN (plus MFA) on every
        // one of these routes; same over-exposure as audit-logs above.
        key: 'worker-logs',
        label: 'System Activity',
        href: '/worker-logs',
        icon: Activity,
        testId: 'nav-worker-logs',
        roles: SUPER_ADMIN_ONLY
      },
      {
        // server/routes/automation.ts permits MANAGER on every rules route;
        // the nav previously hid this item from MANAGER even though they
        // could already use it.
        key: 'rules',
        label: 'Rules',
        href: '/rules',
        icon: Workflow,
        testId: 'nav-rules',
        roles: MANAGER_ROLES
      }
    ]
  }
]

/** Flat list of every nav item, in sidebar order. */
export const navItems: NavItem[] = navGroups.flatMap((group) => group.items)

/**
 * The nav group a route belongs to — the eyebrow for that route's `PageHeader`
 * (Route Experience Spec §1). Returns undefined for routes that are not in nav.
 */
export function navGroupLabelForHref(href: string): string | undefined {
  return navGroups.find((group) => group.items.some((navItem) => navItem.href === href))?.label
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
