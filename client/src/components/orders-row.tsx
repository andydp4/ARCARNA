import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Clock,
  AlertCircle,
  Truck,
  CheckCircle2,
  MoreVertical,
  Eye,
  Calendar,
  Trash2,
  Edit2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ORDER_STATUSES, type OrderStatus } from "@shared/schema";

export interface OrdersListOrder {
  id: string;
  customerId?: string;
  customerName?: string;
  total: string;
  paymentMethod: string;
  status: string;
  createdAt: string;
}

export const STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; color: string; border: string; icon: LucideIcon }
> = {
  pending: { label: "Pending", color: "bg-yellow-500", border: "border-l-yellow-500", icon: Clock },
  "on-hold": { label: "On Hold", color: "bg-orange-500", border: "border-l-orange-500", icon: AlertCircle },
  "awaiting-customer": {
    label: "Awaiting Customer",
    color: "bg-blue-500",
    border: "border-l-blue-500",
    icon: Truck,
  },
  urgent: { label: "Urgent", color: "bg-red-500", border: "border-l-red-500", icon: AlertCircle },
  completed: { label: "Completed", color: "bg-green-500", border: "border-l-green-500", icon: CheckCircle2 },
};

export function formatPaymentLabel(method: string) {
  if (!method) return "—";
  return method.replace(/-/g, " ");
}

function getStatusBorderClass(status: string) {
  const config = STATUS_CONFIG[status as OrderStatus];
  return config?.border ?? "border-l-muted-foreground/40";
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status as OrderStatus] || {
    label: status,
    color: "bg-gray-500",
    border: "border-l-gray-500",
    icon: Clock,
  };
  const Icon = config.icon;
  return (
    <Badge className={cn(config.color, "gap-1 text-white")} data-testid={`badge-status-${status}`}>
      <Icon className="h-3 w-3 shrink-0" />
      {config.label}
    </Badge>
  );
}

export type OrdersRowProps = {
  order: OrdersListOrder;
  onView: (orderId: string) => void;
  onEdit: (orderId: string) => void;
  onUpdateStatus: (order: OrdersListOrder) => void;
  onDelete: (order: OrdersListOrder) => void;
};

function OrdersRowInner({ order, onView, onEdit, onUpdateStatus, onDelete }: OrdersRowProps) {
  const totalNum = parseFloat(order.total || "0");
  const placed = new Date(order.createdAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/35 sm:flex-row sm:items-stretch sm:justify-between sm:gap-4",
        "border-l-4",
        getStatusBorderClass(order.status || "pending")
      )}
      data-testid={`order-${order.id}`}
    >
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="text-base font-semibold leading-snug tracking-tight text-foreground">
            {order.customerName?.trim() || "Walk-in"}
          </p>
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground sm:text-xs">
            #{order.id.slice(0, 8)}
          </span>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          <span>{placed}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2 sm:hidden">
          <span className="text-lg font-bold tabular-nums tracking-tight text-foreground">
            ${totalNum.toFixed(2)}
          </span>
          <Badge variant="secondary" className="max-w-full truncate font-normal capitalize">
            {formatPaymentLabel(order.paymentMethod)}
          </Badge>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:min-w-[11rem] sm:items-end sm:justify-between sm:text-right">
        <div className="hidden flex-col items-end gap-1 sm:flex">
          <span className="text-lg font-bold tabular-nums tracking-tight text-foreground">
            ${totalNum.toFixed(2)}
          </span>
          <Badge variant="secondary" className="font-normal capitalize">
            {formatPaymentLabel(order.paymentMethod)}
          </Badge>
        </div>
        <div className="flex w-full shrink-0 flex-wrap items-stretch gap-2 border-t border-border/60 pt-3 sm:w-auto sm:border-t-0 sm:pt-0">
          <Button
            variant="default"
            size="sm"
            className="min-h-[44px] flex-1 sm:min-w-[5.5rem] sm:flex-none"
            onClick={() => onView(order.id)}
            data-testid={`button-view-order-${order.id}`}
          >
            <Eye className="mr-2 h-4 w-4 shrink-0" />
            View
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="min-h-[44px] min-w-[44px] px-0 sm:px-3"
                data-testid={`button-order-actions-${order.id}`}
                aria-label="More order actions"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => onEdit(order.id)} data-testid="menu-edit-order">
                <Edit2 className="mr-2 h-4 w-4" />
                Edit order
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onUpdateStatus(order)} data-testid="menu-update-status">
                Update status
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(order)}
                data-testid="menu-delete-order"
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete order…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}

export const OrdersRow = memo(
  OrdersRowInner,
  (prev, next) =>
    prev.order === next.order &&
    prev.onView === next.onView &&
    prev.onEdit === next.onEdit &&
    prev.onUpdateStatus === next.onUpdateStatus &&
    prev.onDelete === next.onDelete
);

export { StatusBadge };
