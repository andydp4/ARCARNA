import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check, Copy, Download, Phone, RotateCcw, X } from "lucide-react";
import { apiFetch } from "@/lib/appPaths";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateAfterOrderStatusChange } from "@/lib/query-invalidation";
import { useToast } from "@/hooks/use-toast";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { OrderStatusSelect } from "@/components/orders/OrderStatusSelect";
import { ActionLoader } from "@/components/action-loader";
import { DELAY_CAUSES } from "@shared/delayCauses";
import { formatOrderChannel } from "@shared/orders/channel";
import { localInstantAt, currentTradingDay, shiftIsoDate } from "@shared/time/tradingDay";
import type { OrderStatus } from "@shared/schema";
import type { OpsTimingSettings } from "@shared/orders/opsState";
import type { BoardOrder } from "@/lib/orderTypes";
import { formatPaymentLabel } from "@/lib/paymentLabel";
import { formatTimeOfDay } from "@/lib/opsClock";

/**
 * Everything about one order that does not belong on its card.
 *
 * The card answers "what needs doing now". This answers "what IS this" —
 * lines, money, who to ring, the paperwork, and the two writes that are too
 * consequential to sit a thumb's width from Handed over: changing the status
 * outright, and declaring a delay.
 *
 * A Sheet on anything desktop-sized, an inline panel on a phone (brief, UI →
 * Card → Details). The phone case is not a style preference: the order form
 * lives on the same screen from N6 and the till must never mount a dialog over
 * it, so the board's own detail surface is built without one from the start.
 *
 * This is a new component rather than a reuse of the Open Orders details
 * dialog it replaces — that page and its dialog are deleted in N4b, and
 * inheriting its shape would mean inheriting a modal, a queue-position field
 * that no longer exists, and its `OrderOpsDialog` (unreachable since PR #136).
 */

interface OrderDetail {
  id: string;
  customerId?: string | null;
  customerName?: string | null;
  total: string;
  paymentMethod: string;
  channel?: string | null;
  status: string;
  createdAt: string;
  refundedTotal?: number;
  refunds?: Array<{
    id: string;
    total: string;
    reason: string;
    refundMethod: string;
    createdAt: string;
    cashierName?: string;
  }>;
  items?: Array<{
    id: string;
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: string;
    total: string;
  }>;
}

interface CustomerRow {
  id: string;
  name?: string | null;
  phone?: string | null;
}

export interface OpsDetailsSheetProps {
  order: BoardOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: OpsTimingSettings;
  role?: string;
  statusPending?: boolean;
  /** Held while the board is stale — the same rule the cards follow. */
  blockedReason?: string | null;
  onStatusChange: (order: BoardOrder, status: OrderStatus) => void;
  onEdit: (order: BoardOrder) => void;
  onDelete: (order: BoardOrder) => void;
}

export function OpsDetailsSheet(props: OpsDetailsSheetProps) {
  const { order, open, onOpenChange } = props;
  // lg and up gets the Sheet; a phone gets the same content inline, with no
  // dialog anywhere near the till.
  const isWide = useMediaQuery("(min-width: 1024px)");

  if (!order || !open) return null;

  if (!isWide) {
    return (
      <section
        aria-label={`Order ${order.shortCode} details`}
        data-testid="ops-details-inline"
        className="rounded-xl border border-border bg-card p-4"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Order #{order.shortCode}</h2>
          <Button
            size="touch"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="ops-details-close"
          >
            <X className="h-4 w-4" aria-hidden />
            Close
          </Button>
        </div>
        <OpsDetailsBody {...props} order={order} />
      </section>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // `liquid-metal` is repeated here because Radix portals this content to
        // <body>, outside the shell that scopes the theme's tokens — without it
        // the sheet paints in the bare shadcn palette while the board behind it
        // is dark. Layout.tsx's own mobile nav sheet does the same.
        className="liquid-metal w-full overflow-y-auto bg-background text-foreground sm:max-w-xl"
        data-testid="ops-details-sheet"
      >
        <SheetHeader>
          <SheetTitle>Order #{order.shortCode}</SheetTitle>
          <SheetDescription>
            {order.customerName ?? "Walk-in"} · {formatOrderChannel(order.channel)}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <OpsDetailsBody {...props} order={order} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function OpsDetailsBody({
  order,
  settings,
  role,
  statusPending,
  blockedReason,
  onStatusChange,
  onEdit,
  onDelete,
}: OpsDetailsSheetProps & { order: BoardOrder }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState<string>("");
  const [downloading, setDownloading] = useState<"receipt" | "invoice" | null>(null);
  const canEditOrDelete = role !== "CASHIER";

  const { data: detail, isLoading } = useQuery<OrderDetail>({
    queryKey: ["/api/orders", order.id],
    queryFn: async () => {
      const response = await apiFetch(`/api/orders/${order.id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Could not load this order");
      return response.json();
    },
  });

  // The list projection carries no phone number and the detail endpoint does
  // not join the customer's contact details, so the number comes from the
  // customers query every other screen already keeps warm.
  const { data: customers } = useQuery<CustomerRow[]>({
    queryKey: ["/api/customers"],
    enabled: Boolean(order.customerId),
  });
  const phone = customers?.find((customer) => customer.id === order.customerId)?.phone ?? null;

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      toast({ title: "Could not copy", description: label, variant: "destructive" });
    }
  };

  /**
   * The receipt has its own order route; the invoice endpoint accepts an order
   * id and synthesises the document when the async invoice worker has not
   * written a record yet — so both are always reachable from an order.
   */
  const download = async (kind: "receipt" | "invoice") => {
    setDownloading(kind);
    try {
      const path =
        kind === "receipt" ? `/api/orders/${order.id}/receipt.pdf` : `/api/invoices/${order.id}/pdf`;
      const response = await apiFetch(path, { credentials: "include" });
      if (!response.ok) {
        let reason = `${response.status}`;
        try {
          const body = await response.json();
          if (body?.message) reason = body.message;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(reason);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${kind}-${order.shortCode}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: `Could not download the ${kind}`,
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Customer</p>
            <p className="text-lg font-semibold text-foreground">
              {order.customerName ?? "Walk-in"}
            </p>
            {phone && (
              <Button asChild variant="outline" size="touch" data-testid="button-call-customer">
                <a href={`tel:${phone}`}>
                  <Phone className="h-4 w-4" aria-hidden />
                  {phone}
                </a>
              </Button>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              £{parseFloat(order.total || "0").toFixed(2)}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatPaymentLabel(order.paymentMethod)} · {formatOrderChannel(order.channel)}
            </p>
            {(detail?.refundedTotal ?? 0) > 0 && (
              <p className="mt-1 text-sm text-destructive">
                Refunded £{(detail?.refundedTotal ?? 0).toFixed(2)}
              </p>
            )}
          </div>
        </div>
        <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>Received {formatTimeOfDay(order.enteredAt ?? order.createdAt, settings.timezone)}</span>
          {order.etaGiven && <span>Promised {formatTimeOfDay(order.etaGiven, settings.timezone)}</span>}
          {order.revisedEta && (
            <span>Revised to {formatTimeOfDay(order.revisedEta, settings.timezone)}</span>
          )}
          {order.inputUserName && <span>Loaded by {order.inputUserName}</span>}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="touch"
            variant="outline"
            onClick={() => copy(order.id, "Order number")}
            data-testid="button-copy-order-id"
          >
            {copied === "Order number" ? (
              <Check className="h-4 w-4" aria-hidden />
            ) : (
              <Copy className="h-4 w-4" aria-hidden />
            )}
            Copy order number
          </Button>
          {phone && (
            <Button
              size="touch"
              variant="outline"
              onClick={() => copy(phone, "Phone number")}
              data-testid="button-copy-phone"
            >
              {copied === "Phone number" ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
              Copy phone
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`ops-status-${order.id}`} className="text-sm text-muted-foreground">
          Status
        </Label>
        <OrderStatusSelect
          status={order.status}
          onChange={(status) => onStatusChange(order, status)}
          disabled={statusPending || Boolean(blockedReason)}
          label={`order #${order.shortCode}`}
          data-testid={`select-order-status-${order.id}`}
        />
        {blockedReason && <p className="text-sm text-muted-foreground">{blockedReason}</p>}
      </div>

      <OpsDelayEditor order={order} settings={settings} blockedReason={blockedReason} />

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Line items</h3>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <ActionLoader className="size-5 text-primary" />
            Loading the order…
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(detail?.items ?? []).map((line) => (
              <li key={line.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">
                    {line.productName || "Unknown product"}
                  </span>
                  <span className="block text-sm tabular-nums text-muted-foreground">
                    {line.quantity} × £{Number(line.unitPrice ?? 0).toFixed(2)}
                  </span>
                </span>
                <span className="font-semibold tabular-nums text-foreground">
                  £{Number(line.total ?? 0).toFixed(2)}
                </span>
              </li>
            ))}
            {!isLoading && (detail?.items?.length ?? 0) === 0 && (
              <li className="px-3 py-3 text-sm text-muted-foreground">No lines on this order.</li>
            )}
          </ul>
        )}
      </div>

      {(detail?.refunds?.length ?? 0) > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">Refunds</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {detail?.refunds?.map((refund) => (
              <li key={refund.id} className="px-3 py-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span>
                    {refund.reason.replace(/_/g, " ")} ({refund.refundMethod})
                  </span>
                  <span className="font-medium tabular-nums">
                    −£{parseFloat(refund.total).toFixed(2)}
                  </span>
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  {refund.cashierName ?? "Staff"} · {new Date(refund.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="touch"
          variant="outline"
          disabled={downloading !== null}
          onClick={() => download("receipt")}
          data-testid="button-download-receipt"
        >
          <Download className="h-4 w-4" aria-hidden />
          {downloading === "receipt" ? "Preparing…" : "Receipt"}
        </Button>
        <Button
          size="touch"
          variant="outline"
          disabled={downloading !== null}
          onClick={() => download("invoice")}
          data-testid="button-download-invoice"
        >
          <Download className="h-4 w-4" aria-hidden />
          {downloading === "invoice" ? "Preparing…" : "Invoice"}
        </Button>
        <Button asChild size="touch" variant="outline" data-testid="button-refund-order">
          <Link href={`/open-orders/${order.id}/refund`}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            Issue refund
          </Link>
        </Button>
        {canEditOrDelete && (
          <>
            <Button
              size="touch"
              variant="outline"
              onClick={() => onEdit(order)}
              data-testid="button-edit-order"
            >
              Edit lines
            </Button>
            <Button
              size="touch"
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onDelete(order)}
              data-testid="button-delete-order"
            >
              Delete order…
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Declaring a delay, from the screen the order is already on.
 *
 * `eta_given` has had exactly one writer since PR #136 — `OrderOpsDialog`,
 * which has been unreachable that whole time (finding G3) — so the Delay Log
 * report has been fed by nothing. This is the replacement path, and it writes
 * through the endpoint that already exists (`PATCH /api/orders/:id/operations`)
 * rather than waiting for the transition route in N3b.
 *
 * A revised time is sent as an absolute instant computed in the ORGANISATION's
 * timezone, not the tablet's: `localInstantAt` resolves "18:30" against the
 * shop's day (N0 added it for exactly this), so a device left on the wrong
 * zone cannot promise a customer an hour that never comes.
 */
function OpsDelayEditor({
  order,
  settings,
  blockedReason,
}: {
  order: BoardOrder;
  settings: OpsTimingSettings;
  blockedReason?: string | null;
}) {
  const { toast } = useToast();
  const [cause, setCause] = useState<string>("");
  const [reason, setReason] = useState("");
  const [revisedTime, setRevisedTime] = useState("");
  const [customerTold, setCustomerTold] = useState(false);
  const [saving, setSaving] = useState(false);

  // Pre-filled from whatever the order already says, so declaring a second
  // delay is an edit rather than a re-type.
  useEffect(() => {
    setReason(order.delayReason ?? "");
    setRevisedTime(
      order.revisedEta ? formatTimeOfDay(order.revisedEta, settings.timezone) : "",
    );
    setCause("");
    setCustomerTold(false);
  }, [order.id, order.delayReason, order.revisedEta, settings.timezone]);

  const revisedIsoFromMinutes = (minutes: number) =>
    new Date(Date.now() + minutes * 60_000).toISOString();

  /**
   * "18:30" as an instant on the shop's trading day. A time that has already
   * passed today means the next one — a revised promise is always ahead, and
   * a shop open past midnight would otherwise be told 00:30 this morning. The
   * next day is reached through `shiftIsoDate`, not by adding 24 hours, so the
   * night the clocks change stays honest.
   */
  const revisedIsoFromTime = (hhmm: string): string | null => {
    const normalised = hhmm.slice(0, 5);
    try {
      const today = currentTradingDay(settings.timezone);
      const instant = localInstantAt(today, normalised, settings.timezone);
      if (instant.getTime() >= Date.now()) return instant.toISOString();
      return localInstantAt(shiftIsoDate(today, 1), normalised, settings.timezone).toISOString();
    } catch {
      toast({
        title: "That is not a time we can use",
        description: "Give the new time as HH:MM, for example 18:30.",
        variant: "destructive",
      });
      return null;
    }
  };

  const save = async (revisedEtaIso: string | null, clearing = false) => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = clearing
        ? { delayFlag: false, delayResolution: "Collected late" }
        : {
            delayFlag: true,
            ...(cause ? { delayCause: cause } : {}),
            ...(reason.trim() ? { delayReason: reason.trim() } : {}),
            ...(revisedEtaIso ? { revisedEta: revisedEtaIso } : {}),
            ...(customerTold ? { notifyCustomerNow: true } : {}),
          };
      const response = await apiRequest("PATCH", `/api/orders/${order.id}/operations`, body);
      await response.json();
      await invalidateAfterOrderStatusChange(queryClient);
      toast({
        title: clearing ? "Delay cleared" : "Delay recorded",
        description: clearing
          ? `Order #${order.shortCode} is no longer flagged.`
          : `Order #${order.shortCode} now shows a new time.`,
      });
    } catch (error) {
      toast({
        title: "Could not save the delay",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const disabled = saving || Boolean(blockedReason);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3" data-testid="ops-delay-editor">
      <h3 className="text-sm font-medium text-foreground">
        {order.delayFlag ? "This order is delayed" : "Running late?"}
      </h3>

      <div className="space-y-1">
        <Label htmlFor={`ops-delay-cause-${order.id}`} className="text-xs text-muted-foreground">
          What is holding it up
        </Label>
        <Select value={cause} onValueChange={setCause} disabled={disabled}>
          <SelectTrigger
            id={`ops-delay-cause-${order.id}`}
            className="min-h-11"
            data-testid="select-delay-cause"
          >
            <SelectValue placeholder="Choose a cause" />
          </SelectTrigger>
          <SelectContent>
            {DELAY_CAUSES.map((option) => (
              <SelectItem key={option} value={option} data-testid={`delay-cause-${option}`}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`ops-delay-reason-${order.id}`} className="text-xs text-muted-foreground">
          What to tell the customer
        </Label>
        <Input
          id={`ops-delay-reason-${order.id}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="min-h-11"
          placeholder="Waiting on the bakery delivery"
          disabled={disabled}
          data-testid="input-delay-reason"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={`ops-delay-time-${order.id}`} className="text-xs text-muted-foreground">
          New time
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          {[10, 20, 30].map((minutes) => (
            <Button
              key={minutes}
              size="touch"
              variant="outline"
              disabled={disabled}
              onClick={() => save(revisedIsoFromMinutes(minutes))}
              data-testid={`chip-delay-${minutes}`}
            >
              +{minutes} min
            </Button>
          ))}
          <Input
            id={`ops-delay-time-${order.id}`}
            type="time"
            value={revisedTime}
            onChange={(event) => setRevisedTime(event.target.value)}
            className="min-h-11 w-36"
            disabled={disabled}
            data-testid="input-delay-time"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id={`ops-delay-told-${order.id}`}
          checked={customerTold}
          onCheckedChange={setCustomerTold}
          disabled={disabled}
          data-testid="switch-customer-told"
        />
        <Label htmlFor={`ops-delay-told-${order.id}`} className="text-sm font-normal">
          I have just told the customer
        </Label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="touch"
          disabled={disabled}
          onClick={() => save(revisedTime ? revisedIsoFromTime(revisedTime) : null)}
          data-testid="button-save-delay"
        >
          {saving ? "Saving…" : "Record delay"}
        </Button>
        {order.delayFlag && (
          <Button
            size="touch"
            variant="outline"
            disabled={disabled}
            onClick={() => save(null, true)}
            data-testid="button-clear-delay"
          >
            Clear delay
          </Button>
        )}
      </div>
    </div>
  );
}
