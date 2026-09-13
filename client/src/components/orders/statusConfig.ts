import { AlertCircle, CheckCircle2, Clock, Pause, Truck, type LucideIcon } from "lucide-react";
import type { OrderStatus } from "@shared/schema";

/**
 * How each order status looks, in one place.
 *
 * Extracted from orders-row so the row and OrderStatusSelect can share it
 * without importing each other — the row renders the selector, and the
 * selector needs the same colours and labels the row uses for its border.
 *
 * `on-hold` was `bg-orange-700` / `border-l-orange-700` (unrelated to any of
 * the Operations Centre's tokens, and orange is spoken for — it means
 * "delayed" everywhere else on the board). The Operations Centre's brief
 * ("Owner's answers", Q1; "Colour resolution") calls held a dashed
 * light-blue border and chip, `--ops-held`, proven ≥4.5:1 against its own
 * dark text by `shared/ui/contrast.spec.ts` (N0) — this reuses that exact
 * token rather than inventing a second "held" colour for the one other place
 * `on-hold` is still drawn (`OrderStatusSelect`'s dot and left border; the
 * board itself never reads `STATUS_CONFIG`, see `OpsCard.tsx`'s own
 * `STATE_STYLES`). The icon changes to match `OpsCard`'s held icon (`Pause`)
 * for the same order — one status, one picture, wherever it is drawn.
 */
export const STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; color: string; border: string; icon: LucideIcon }
> = {
  pending: { label: "Pending", color: "bg-yellow-700", border: "border-l-yellow-700", icon: Clock },
  "on-hold": { label: "On Hold", color: "bg-ops-held", border: "border-l-ops-held", icon: Pause },
  "awaiting-customer": {
    label: "Awaiting Customer",
    color: "bg-blue-600",
    border: "border-l-blue-600",
    icon: Truck,
  },
  urgent: { label: "Urgent", color: "bg-red-600", border: "border-l-red-600", icon: AlertCircle },
  completed: { label: "Completed", color: "bg-green-700", border: "border-l-green-700", icon: CheckCircle2 },
};

