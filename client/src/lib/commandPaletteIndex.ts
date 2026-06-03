import type { QueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  Home,
  ShoppingCart,
  PackageCheck,
  Package,
  Users,
  Settings,
} from "lucide-react";
import type { Customer, Product } from "@shared/schema";
import {
  getVisibleCommandPaletteActions,
  type CommandPaletteAction,
} from "@shared/commandPaletteActions";
import type { OrdersListOrder } from "@/components/orders-row";

export type CommandPaletteSection = "pages" | "customers" | "products" | "orders" | "actions";

export type CommandPaletteItem = {
  id: string;
  section: CommandPaletteSection;
  label: string;
  subtext?: string;
  href?: string;
  icon?: LucideIcon;
  recentBoost?: number;
};

const PAGE_JUMP_ROUTES: Array<{ id: string; label: string; href: string; icon: LucideIcon }> = [
  { id: "page-home", label: "Dashboard", href: "/", icon: Home },
  { id: "page-pos", label: "POS Terminal", href: "/pos", icon: ShoppingCart },
  { id: "page-orders", label: "Orders", href: "/orders", icon: PackageCheck },
  { id: "page-products", label: "Products", href: "/products", icon: Package },
  { id: "page-customers", label: "Customers", href: "/customers", icon: Users },
  { id: "page-settings", label: "Settings", href: "/settings", icon: Settings },
];

const RECENT_STORAGE_PREFIX = "midnight-command-palette-recent";
const MAX_RECENT = 20;

function readArrayFromCache<T>(queryClient: QueryClient, queryKey: readonly unknown[]): T[] {
  const cached = queryClient.getQueryData<T[]>(queryKey);
  return Array.isArray(cached) ? cached : [];
}

type SmartStockItem = {
  productId: string;
  unitsSoldWindow: number;
};

type SmartStockCache = {
  items?: SmartStockItem[];
};

function productSalesRank(queryClient: QueryClient): Map<string, number> {
  const smartStock = queryClient.getQueryData<SmartStockCache>([
    "/api/inventory/smart-stock?windowDays=30",
  ]);
  const rank = new Map<string, number>();
  for (const item of smartStock?.items ?? []) {
    rank.set(item.productId, item.unitsSoldWindow ?? 0);
  }
  return rank;
}

export function getRecentPaletteIds(userId: string | undefined): string[] {
  if (!userId || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${RECENT_STORAGE_PREFIX}:${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function recordPaletteSelection(userId: string | undefined, itemId: string): void {
  if (!userId || typeof localStorage === "undefined") return;
  const existing = getRecentPaletteIds(userId).filter((id) => id !== itemId);
  const next = [itemId, ...existing].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(`${RECENT_STORAGE_PREFIX}:${userId}`, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
}

export async function ensurePaletteData(queryClient: QueryClient): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (readArrayFromCache<Customer>(queryClient, ["/api/customers"]).length === 0) {
    tasks.push(queryClient.prefetchQuery({ queryKey: ["/api/customers"] }));
  }
  if (readArrayFromCache<Product>(queryClient, ["/api/products"]).length === 0) {
    tasks.push(queryClient.prefetchQuery({ queryKey: ["/api/products"] }));
  }
  if (readArrayFromCache<OrdersListOrder>(queryClient, ["/api/orders"]).length === 0) {
    tasks.push(queryClient.prefetchQuery({ queryKey: ["/api/orders"] }));
  }
  await Promise.allSettled(tasks);
}

function recentBoostFor(id: string, recentIds: string[]): number {
  const index = recentIds.indexOf(id);
  if (index === -1) return 0;
  return MAX_RECENT - index;
}

function buildPageItems(recentIds: string[]): CommandPaletteItem[] {
  return PAGE_JUMP_ROUTES.map((page) => ({
    id: page.id,
    section: "pages" as const,
    label: page.label,
    href: page.href,
    icon: page.icon,
    recentBoost: recentBoostFor(page.id, recentIds),
  }));
}

function buildCustomerItems(customers: Customer[], recentIds: string[]): CommandPaletteItem[] {
  return [...customers]
    .sort((a, b) => {
      const aTime = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
      const bTime = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
      return bTime - aTime;
    })
    .slice(0, 10)
    .map((customer) => {
      const id = `customer-${customer.id}`;
      return {
        id,
        section: "customers" as const,
        label: customer.name,
        subtext: customer.email ?? customer.phone ?? undefined,
        href: "/customers",
        recentBoost: recentBoostFor(id, recentIds),
      };
    });
}

function buildProductItems(
  products: Product[],
  salesRank: Map<string, number>,
  recentIds: string[],
): CommandPaletteItem[] {
  return [...products]
    .sort((a, b) => {
      const soldDiff = (salesRank.get(b.id) ?? 0) - (salesRank.get(a.id) ?? 0);
      if (soldDiff !== 0) return soldDiff;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 10)
    .map((product) => {
      const id = `product-${product.id}`;
      const sold = salesRank.get(product.id);
      return {
        id,
        section: "products" as const,
        label: product.name,
        subtext: sold != null && sold > 0 ? `${sold} sold (30d)` : product.productId,
        href: "/products",
        recentBoost: recentBoostFor(id, recentIds),
      };
    });
}

function buildOrderItems(orders: OrdersListOrder[], recentIds: string[]): CommandPaletteItem[] {
  return [...orders]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)
    .map((order) => {
      const id = `order-${order.id}`;
      const total = Number.parseFloat(order.total);
      const totalLabel = Number.isFinite(total) ? `£${total.toFixed(2)}` : order.total;
      return {
        id,
        section: "orders" as const,
        label: order.customerName ? `Order — ${order.customerName}` : `Order ${order.id.slice(0, 8)}`,
        subtext: `${totalLabel} · ${order.status}`,
        href: "/orders",
        recentBoost: recentBoostFor(id, recentIds),
      };
    });
}

function buildActionItems(actions: CommandPaletteAction[], recentIds: string[]): CommandPaletteItem[] {
  return actions.map((action) => ({
    id: action.id,
    section: "actions" as const,
    label: action.label,
    subtext: action.keywords?.slice(0, 3).join(", "),
    href: action.href,
    recentBoost: recentBoostFor(action.id, recentIds),
  }));
}

export function buildCommandPaletteIndex(
  queryClient: QueryClient,
  userRole: string | undefined,
  userId: string | undefined,
): CommandPaletteItem[] {
  const recentIds = getRecentPaletteIds(userId);
  const customers = readArrayFromCache<Customer>(queryClient, ["/api/customers"]);
  const products = readArrayFromCache<Product>(queryClient, ["/api/products"]);
  const orders = readArrayFromCache<OrdersListOrder>(queryClient, ["/api/orders"]);
  const salesRank = productSalesRank(queryClient);
  const actions = getVisibleCommandPaletteActions(userRole);

  return [
    ...buildPageItems(recentIds),
    ...buildCustomerItems(customers, recentIds),
    ...buildProductItems(products, salesRank, recentIds),
    ...buildOrderItems(orders, recentIds),
    ...buildActionItems(actions, recentIds),
  ].sort((a, b) => (b.recentBoost ?? 0) - (a.recentBoost ?? 0));
}

export const COMMAND_PALETTE_SECTION_LABELS: Record<CommandPaletteSection, string> = {
  pages: "Jump to page",
  customers: "Customers",
  products: "Products",
  orders: "Orders",
  actions: "Actions",
};
