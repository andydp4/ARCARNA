import type { Role } from "./schema";
import { roleRank } from "./rbac";

export type BulkEntity = "customers" | "products" | "orders";

export type BulkActionId = "delete" | "export" | "tag" | "changeCategory";

export type BulkActionDef = {
  id: BulkActionId;
  label: string;
  destructive?: boolean;
  minRole: Role;
  confirmText?: string;
};

const CUSTOMER_ACTIONS: BulkActionDef[] = [
  { id: "export", label: "Export CSV", minRole: "CASHIER" },
  { id: "tag", label: "Set category", minRole: "MANAGER" },
  { id: "delete", label: "Delete", minRole: "MANAGER", destructive: true, confirmText: "DELETE" },
];

const PRODUCT_ACTIONS: BulkActionDef[] = [
  { id: "export", label: "Export CSV", minRole: "CASHIER" },
  { id: "delete", label: "Delete", minRole: "MANAGER", destructive: true, confirmText: "DELETE" },
];

const ORDER_ACTIONS: BulkActionDef[] = [
  { id: "export", label: "Export CSV", minRole: "CASHIER" },
  { id: "tag", label: "Set status", minRole: "MANAGER" },
];

export const BULK_ACTIONS: Record<BulkEntity, BulkActionDef[]> = {
  customers: CUSTOMER_ACTIONS,
  products: PRODUCT_ACTIONS,
  orders: ORDER_ACTIONS,
};

export function getBulkActionsForRole(entity: BulkEntity, role: Role): BulkActionDef[] {
  const rank = roleRank(role);
  return BULK_ACTIONS[entity].filter((action) => rank >= roleRank(action.minRole));
}

export function isBulkActionAllowed(entity: BulkEntity, action: BulkActionId, role: Role): boolean {
  return getBulkActionsForRole(entity, role).some((a) => a.id === action);
}

export function getBulkActionDef(entity: BulkEntity, action: BulkActionId): BulkActionDef | undefined {
  return BULK_ACTIONS[entity].find((a) => a.id === action);
}

export type BulkRequest = {
  ids: string[];
  action: BulkActionId;
  payload?: Record<string, unknown>;
};

export function parseBulkRequest(body: unknown): BulkRequest | null {
  if (!body || typeof body !== "object") return null;
  const { ids, action, payload } = body as BulkRequest;
  if (!Array.isArray(ids) || ids.length === 0 || typeof action !== "string") return null;
  if (ids.some((id) => typeof id !== "string" || !id)) return null;
  return { ids: ids.slice(0, 500), action: action as BulkActionId, payload };
}
