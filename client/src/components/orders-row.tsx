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
  AlertTriangle,
  Calendar,
  Check,
  Clock,
  Edit2,
  Eye,
  Globe2,
  MoreVertical,
  Trash2,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OrderStatusSelect } from "@/components/orders/OrderStatusSelect";
import { STATUS_CONFIG as STATUS_CONFIG_INTERNAL } from "@/components/orders/statusConfig";
import { Checkbox } from "@/components/ui/checkbox";
import type { OrderStatus } from "@shared/schema";
import { formatOrderChannel, isWebsiteOrder } from "@shared/orders/channel";

export interface OrdersListOrder {
  id: string;
  customerId?: string;
  customerName?: string;
  total: string;
  paymentMethod: string;
  channel?: string;
  status: string;
  createdAt: string;
  /** Who loaded it — this is where the inputter's 10% goes. */
  inputUserName?: string | null;
  /** Already on the order and never shown: what is holding it up. */
  delayFlag?: boolean;
  delayReason?: string | null;
  revisedEta?: string | null;
  etaGiven?: string | null;
}

/**
 * How long an order has been waiting, and how loudly to say so.
 *
 * The counter view exists to answer "what is waiting and how long has it
 * waited", and a timestamp does not answer that — a person reading
 * "14:32" has to do arithmetic to find out that it has been sitting for
 * forty minutes. The thresholds escalate so a glance is enough.
 */
export function describeWait(createdAt: string, now: number = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60000));
  const label =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${minutes} min`
        : minutes < 60 * 24
          ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
          : `${Math.floor(minutes / (60 * 24))}d`;
  const tone =
    minutes >= 60 ? "text-destructive" : minutes >= 20 ? "text-warning" : "text-muted-foreground";
  return { minutes, label, tone };
}

export { STATUS_CONFIG } from "@/components/orders/statusConfig";

// Tender values that read as something other than their own name — "tick" is
// the one case: the internal payment_method value stayed "tick" (it is a
// stored data value across every historic order, not just a label) after the
// credit rework, but nothing anywhere should show a customer or a member of
// staff the word "tick" any more.
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  tick: "Credit",
};

export function formatPaymentLabel(method: string) {
  if (!method) return "—";
  const known = PAYMENT_METHOD_LABELS[method.toLowerCase()];
  if (known) return known;
  const spaced = method.replace(/[-_]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function getStatusBorderClass(status: string) {
  const config = STATUS_CONFIG_INTERNAL[status as OrderStatus];
  return config?.border ?? "border-l-muted-foreground/40";
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG_INTERNAL[status as OrderStatus] || {
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
  /** Completing from the list is the whole point of the counter view. */
  onComplete?: (order: OrdersListOrder) => void;
  onView: (orderId: string) => void;
  onEdit: (orderId: string) => void;
  onStatusChange: (order: OrdersListOrder, status: OrderStatus) => void;
  /** True while this row's status write is in flight. */
  statusPending?: boolean;
  onDelete: (order: OrdersListOrder) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
};

function OrdersRowInner({ order, onComplete, onView, onEdit, onStatusChange, statusPending, onDelete, selected, onToggleSelect }: OrdersRowProps) {
  const totalNum = parseFloat(order.total || "0");
  const placed = new Date(order.createdAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const wait = describeWait(order.createdAt);
  const isOpen = (order.status || "pending") !== "completed";
  const eta = order.revisedEta ?? order.etaGiven ?? null;

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/35 sm:flex-row sm:items-stretch sm:justify-between sm:gap-4",
        "border-l-4",
        getStatusBorderClass(order.status || "pending")
      )}
      data-testid={`order-${order.id}`}
    >
      {onToggleSelect && (
        <div className="flex items-start sm:items-center">
          <Checkbox checked={!!selected} onCheckedChange={onToggleSelect} aria-label={`Select order ${order.id.slice(0, 8)}`} />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="text-base font-semibold leading-snug tracking-tight text-foreground">
            {order.customerName?.trim() || "Walk-in"}
          </p>
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground sm:text-xs">
            #{order.id.slice(0, 8)}
          </span>
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {isOpen && (
            <span className={cn("inline-flex items-center gap-1.5 font-medium", wait.tone)}>
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Waiting {wait.label}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
            {placed}
          </span>
          {order.inputUserName && (
            // Who to ask about it, and who earns the inputter's share of it.
            <span className="inline-flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
              Loaded by {order.inputUserName}
            </span>
          )}
        </p>
        {isOpen && (order.delayFlag || eta) && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {order.delayFlag && (
              <span className="inline-flex items-center gap-1.5 font-medium text-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {order.delayReason?.trim() || "Delayed"}
              </span>
            )}
            {eta && (
              <span className="text-muted-foreground">
                Due {new Date(eta).toLocaleTimeString(undefined, { timeStyle: "short" })}
              </span>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={isWebsiteOrder(order.channel) ? "secondary" : "outline"}
            className="max-w-full gap-1 truncate font-normal"
            data-testid={`badge-order-channel-${order.id}`}
          >
            {isWebsiteOrder(order.channel) && <Globe2 className="h-3 w-3 shrink-0" />}
            {formatOrderChannel(order.channel)}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:hidden">
          <span className="text-lg font-bold tabular-nums tracking-tight text-foreground">
            £{totalNum.toFixed(2)}
          </span>
          <Badge variant="secondary" className="max-w-full truncate font-normal capitalize">
            {formatPaymentLabel(order.paymentMethod)}
          </Badge>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:min-w-[11rem] sm:items-end sm:justify-between sm:text-right">
        <div className="hidden flex-col items-end gap-1 sm:flex">
          <span className="text-lg font-bold tabular-nums tracking-tight text-foreground">
            £{totalNum.toFixed(2)}
          </span>
          <Badge variant="secondary" className="font-normal capitalize">
            {formatPaymentLabel(order.paymentMethod)}
          </Badge>
        </div>
        <div className="flex w-full shrink-0 flex-wrap items-stretch gap-2 border-t border-border/60 pt-3 sm:w-auto sm:border-t-0 sm:pt-0">
          <OrderStatusSelect
            status={order.status || "pending"}
            onChange={(status) => onStatusChange(order, status)}
            disabled={statusPending}
            label={`order #${order.id.slice(0, 8)}`}
            data-testid={`select-order-status-${order.id}`}
          />
          {isOpen && onComplete && (
            // One action, from the list. Completing used to mean opening the
            // status dropdown and picking the right value — on the screen where
            // completing is the single most common thing anybody does, and
            // where the completer earns 90% of the order's commission.
            <Button
              variant="default"
              size="sm"
              className="min-h-[44px] flex-1 sm:min-w-[6.5rem] sm:flex-none"
              onClick={() => onComplete(order)}
              disabled={statusPending}
              data-testid={`button-complete-order-${order.id}`}
            >
              <Check className="mr-2 h-4 w-4 shrink-0" />
              Complete
            </Button>
          )}
          <Button
            variant={isOpen && onComplete ? "outline" : "default"}
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
    prev.onStatusChange === next.onStatusChange &&
    prev.onComplete === next.onComplete &&
    prev.statusPending === next.statusPending &&
    prev.onDelete === next.onDelete
);

export { StatusBadge };
