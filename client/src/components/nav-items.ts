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
  Workflow,
  CalendarClock,
  Activity,
  Timer,
  Ticket,
  Clock,
  Radio,
  Layers,
} from 'lucide-react'

export const navItems = [
  {
    key: 'home',
    label: 'Dashboard',
    href: '/',
    icon: Home,
    testId: 'nav-home'
  },
  {
    key: 'pos',
    label: 'POS Terminal',
    href: '/pos',
    icon: ShoppingCart,
    testId: 'nav-pos'
  },
  {
    key: 'orders',
    label: 'Orders',
    href: '/orders',
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
    testId: 'nav-customers'
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
    key: 'insights',
    label: 'Business Insights',
    href: '/insights',
    icon: TrendingUp,
    testId: 'nav-insights'
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
    key: 'expenses',
    label: 'Expenses',
    href: '/expenses',
    icon: Wallet,
    testId: 'nav-expenses'
  },
  {
    key: 'profit',
    label: 'Profit Analysis',
    href: '/expense-reports',
    icon: PieChart,
    testId: 'nav-profit'
  },
  {
    key: 'promotions',
    label: 'Promotions',
    href: '/promotions',
    icon: Gift,
    testId: 'nav-promotions'
  },
  {
    key: 'locations',
    label: 'Locations',
    href: '/locations',
    icon: MapPin,
    testId: 'nav-locations'
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
    key: 'audit-logs',
    label: 'Audit log',
    href: '/audit-logs',
    icon: Shield,
    testId: 'nav-audit-logs'
  },
  {
    key: 'worker-logs',
    label: 'Worker logs',
    href: '/worker-logs',
    icon: Activity,
    testId: 'nav-worker-logs'
  },
  {
    key: 'rules',
    label: 'Automation rules',
    href: '/rules',
    icon: Workflow,
    testId: 'nav-rules'
  },
  {
    key: 'scheduled-reports',
    label: 'Scheduled reports',
    href: '/scheduled-reports',
    icon: CalendarClock,
    testId: 'nav-scheduled-reports'
  },
  {
    key: 'user-access',
    label: 'User Access',
    href: '/user-access',
    icon: Shield,
    testId: 'nav-user-access'
  },
  {
    key: 'settings',
    label: 'Settings',
    href: '/settings',
    icon: Settings,
    testId: 'nav-settings'
  }
]