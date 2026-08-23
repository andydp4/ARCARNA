import { AlertCircle, CheckCircle2, Clock, Truck, type LucideIcon } from "lucide-react";
import type { OrderStatus } from "@shared/schema";

/**
 * How each order status looks, in one place.
 *
 * Extracted from orders-row so the row and OrderStatusSelect can share it
 * without importing each other — the row renders the selector, and the
 * selector needs the same colours and labels the row uses for its border.
 */
export const STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; color: string; border: string; icon: LucideIcon }
> = {
  pending: { label: "Pending", color: "bg-yellow-700", border: "border-l-yellow-700", icon: Clock },
  "on-hold": { label: "On Hold", color: "bg-orange-700", border: "border-l-orange-700", icon: AlertCircle },
  "awaiting-customer": {
    label: "Awaiting Customer",
    color: "bg-blue-600",
    border: "border-l-blue-600",
    icon: Truck,
  },
  urgent: { label: "Urgent", color: "bg-red-600", border: "border-l-red-600", icon: AlertCircle },
  completed: { label: "Completed", color: "bg-green-700", border: "border-l-green-700", icon: CheckCircle2 },
};

