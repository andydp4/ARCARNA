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
        testId: 'nav-products'
      },
      {
        key: 'inventory',
        label: VOCAB.stockTruths,
        href: '/inventory',
        icon: Boxes,
        testId: 'nav-inventory'
      },
      {
        key: 'purchase-drafts',
        label: 'Purchase Drafts',
        href: '/purchase-drafts',
        icon: ClipboardList,
        testId: 'nav-purchase-drafts'
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
        testId: 'nav-insights'
      },
      {
        key: 'reports-hub',
        label: 'Reports',
        href: '/reports',
        icon: FileBarChart,
        testId: 'nav-reports-hub'
      },
      {
        key: 'rfm',
        label: VOCAB.customerTruths,
        href: '/analytics/rfm',
        icon: PieChart,
        testId: 'nav-rfm'
      },
      {
        key: 'hour-of-day',
        label: 'Busiest Hours',
        href: '/analytics/hour-of-day',
        icon: Clock,
        testId: 'nav-hour-of-day'
      },
      {
        key: 'channels',
        label: 'Order Channels',
        href: '/analytics/channels',
        icon: Radio,
        testId: 'nav-channels'
      },
      {
        key: 'stock-turn',
        label: 'Stock Turn',
        href: '/analytics/stock-turn',
        icon: Layers,
        testId: 'nav-stock-turn'
      },
      {
        key: 'profit',
        label: VOCAB.profitTruths,
        href: '/expense-reports',
        icon: PieChart,
        testId: 'nav-profit'
      },
      {
        key: 'scheduled-reports',
        label: 'Scheduled Evidence',
        href: '/scheduled-reports',
        icon: CalendarClock,
        testId: 'nav-scheduled-reports'
      }
    ]
  },
  {
    key: 'operate',
    label: 'Operate',
    testId: 'nav-group-operate',
    items: [
      {
        key: 'customers',
        label: 'Customers',
        href: '/customers',
        icon: Users,
        testId: 'nav-customers'
      },
      {
        key: 'loyalty',
        label: 'Loyalty',
        href: '/loyalty',
        icon: Award,
        testId: 'nav-loyalty'
      },
      {
        key: 'promotions',
        label: 'Promotions',
        href: '/promotions',
        icon: Gift,
        testId: 'nav-promotions'
      },
      {
        key: 'gift-cards',
        label: 'Gift Cards',
        href: '/gift-cards',
        icon: Ticket,
        testId: 'nav-gift-cards'
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
        testId: 'nav-expenses'
      },
      {
        key: 'reseller-partners',
        label: 'Reseller Partners',
        href: '/reseller-partners',
        icon: Handshake,
        testId: 'nav-reseller-partners'
      },
      {
        key: 'cashier-payroll',
        label: 'Cashier Payroll',
        href: '/cashier-payroll',
        icon: Wallet,
        testId: 'nav-cashier-payroll'
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
        key: 'developer',
        label: 'Developer',
        href: '/settings/developer',
        icon: Code2,
        testId: 'nav-developer'
      },
      {
        key: 'audit-logs',
        label: 'Audit Log',
        href: '/audit-logs',
        icon: ScrollText,
        testId: 'nav-audit-logs',
        roles: ADMIN_ROLES
      },
      {
        key: 'worker-logs',
        label: 'System Activity',
        href: '/worker-logs',
        icon: Activity,
        testId: 'nav-worker-logs',
        roles: ADMIN_ROLES
      },
      {
        key: 'rules',
        label: 'Rules',
        href: '/rules',
        icon: Workflow,
        testId: 'nav-rules',
        roles: ADMIN_ROLES
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
