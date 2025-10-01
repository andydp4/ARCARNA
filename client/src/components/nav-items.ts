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
  BarChart3,
  Home,
  Award
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
    key: 'inventory',
    label: 'Inventory',
    href: '/inventory',
    icon: Package,
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
    key: 'loyalty',
    label: 'Loyalty',
    href: '/loyalty',
    icon: Award,
    testId: 'nav-loyalty'
  },
  {
    key: 'reports',
    label: 'Reports',
    href: '/reports',
    icon: TrendingUp,
    testId: 'nav-reports'
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
    key: 'analytics',
    label: 'Analytics',
    href: '/analytics',
    icon: BarChart3,
    testId: 'nav-analytics'
  }
]