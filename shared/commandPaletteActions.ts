import { type Role } from "./schema";
import { isRole, roleRank } from "./rbac";

export type CommandPaletteAction = {
  id: string;
  label: string;
  keywords?: string[];
  href: string;
  minRole?: Role;
};

export const commandPaletteActions: CommandPaletteAction[] = [
  {
    id: "action-create-order",
    label: "Create order",
    keywords: ["pos", "sale", "checkout", "new order"],
    href: "/create-order",
  },
  {
    id: "action-open-pos",
    label: "Open POS terminal",
    keywords: ["pos", "terminal", "register"],
    href: "/create-order",
  },
  {
    id: "action-add-product",
    label: "Add product",
    keywords: ["product", "catalog", "sku", "inventory"],
    href: "/products",
    minRole: "MANAGER",
  },
  {
    id: "action-add-customer",
    label: "Add customer",
    keywords: ["customer", "contact", "crm"],
    href: "/customers",
  },
  {
    id: "action-z-report",
    label: "Open today's Z-report",
    keywords: ["z-report", "shift", "close", "cash", "end of day"],
    href: "/shifts",
  },
  {
    id: "action-insights",
    label: "Open business insights",
    keywords: ["reports", "analytics", "dashboard", "revenue"],
    href: "/insights",
    minRole: "MANAGER",
  },
  {
    id: "action-settings",
    label: "Open settings",
    keywords: ["settings", "preferences", "configuration"],
    href: "/settings",
    minRole: "MANAGER",
  },
];

export function isCommandPaletteActionAllowed(
  action: CommandPaletteAction,
  userRole: string | undefined,
): boolean {
  if (!action.minRole) return true;
  if (!userRole || !isRole(userRole)) return false;
  if (!isRole(action.minRole)) return true;
  return roleRank(userRole) >= roleRank(action.minRole);
}

export function getVisibleCommandPaletteActions(userRole: string | undefined): CommandPaletteAction[] {
  return commandPaletteActions.filter((action) => isCommandPaletteActionAllowed(action, userRole));
}
