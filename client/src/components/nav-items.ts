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
} from 'lucide-react'

export interface NavItem {
  key: string
  label: string
  href: string
  icon: LucideIcon
  testId: string
  children?: NavItem[]
}

export const navItems: NavItem[] = [
  {
    key: 'home',
    label: 'Dashboard',
    href: '/',
    icon: Home,
    testId: 'nav-home'
  },
  {
    key: 'pos',
    label: 'Create Order',
    href: '/create-order',
    icon: ShoppingCart,
    testId: 'nav-pos'
  },
  {
    key: 'orders',
    label: 'Open Orders',
    href: '/open-orders',
    icon: PackageCheck,
    testId: 'nav-orders',
    children: [
      {
        key: 'orders-main',
        label: 'Open Orders',
        href: '/open-orders',
        icon: PackageCheck,
        testId: 'nav-orders-main'
      },
      {
        key: 'shifts',
        label: 'Shifts',
        href: '/shifts',
        icon: Timer,
        testId: 'nav-shifts'
      },
      {
        key: 'locations',
        label: 'Locations',
        href: '/locations',
        icon: MapPin,
        testId: 'nav-locations'
      }
    ]
  },
  {
    key: 'products',
    label: 'Products',
    href: '/products',
    icon: Package,
    testId: 'nav-products'
  },
  {
    key: 'inventory',
    label: 'Inventory',
    href: '/inventory',
    icon: Boxes,
    testId: 'nav-inventory'
  },
  {
    key: 'customers',
    label: 'Customers',
    href: '/customers',
    icon: Users,
    testId: 'nav-customers',
    children: [
      {
        key: 'customers-main',
        label: 'Customers',
        href: '/customers',
        icon: Users,
        testId: 'nav-customers-main'
      },
      {
        key: 'gift-cards',
        label: 'Gift cards',
        href: '/gift-cards',
        icon: Ticket,
        testId: 'nav-gift-cards'
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
      }
    ]
  },
  {
    key: 'insights',
    label: 'Business Insights',
    href: '/insights',
    icon: TrendingUp,
    testId: 'nav-insights',
    children: [
      {
        key: 'insights-main',
        label: 'Overview',
        href: '/insights',
        icon: TrendingUp,
        testId: 'nav-insights-main'
      },
      {
        key: 'rfm',
        label: 'RFM Segments',
        href: '/analytics/rfm',
        icon: PieChart,
        testId: 'nav-rfm'
      },
      {
        key: 'hour-of-day',
        label: 'Hour of day',
        href: '/analytics/hour-of-day',
        icon: Clock,
        testId: 'nav-hour-of-day'
      },
      {
        key: 'channels',
        label: 'Channels',
        href: '/analytics/channels',
        icon: Radio,
        testId: 'nav-channels'
      },
      {
        key: 'stock-turn',
        label: 'Stock turn',
        href: '/analytics/stock-turn',
        icon: Layers,
        testId: 'nav-stock-turn'
      },
      {
        key: 'profit',
        label: 'Profit Analysis',
        href: '/expense-reports',
        icon: PieChart,
        testId: 'nav-profit'
      },
      {
        key: 'scheduled-reports',
        label: 'Scheduled reports',
        href: '/scheduled-reports',
        icon: CalendarClock,
        testId: 'nav-scheduled-reports'
      }
    ]
  },
  {
    key: 'expenses',
    label: 'Expenses',
    href: '/expenses',
    icon: Wallet,
    testId: 'nav-expenses'
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
    label: 'Tick List',
    href: '/tick-list',
    icon: CreditCard,
    testId: 'nav-tick-list'
  },
  {
    key: 'settings',
    label: 'Settings',
    href: '/settings',
    icon: Settings,
    testId: 'nav-settings',
    children: [
      {
        key: 'settings-main',
        label: 'General',
        href: '/settings',
        icon: Settings,
        testId: 'nav-settings-main'
      },
      {
        key: 'developer',
        label: 'Developer',
        href: '/settings/developer',
        icon: Code2,
        testId: 'nav-developer'
      },
      {
        key: 'user-access',
        label: 'User Access',
        href: '/user-access',
        icon: Shield,
        testId: 'nav-user-access'
      }
    ]
  }
]
