import { memo, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { CardLinkDialog } from "@/components/card-link/CardLinkDialog";
import {
  AlertTriangle,
  BellRing,
  Calendar,
  CalendarClock,
  Check,
  Clock,
  Globe2,
  MapPin,
  Pause,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatOrderChannel, isWebsiteOrder } from "@shared/orders/channel";
import type { CardState, DerivedCardState, OpsTimingSettings } from "@shared/orders/opsState";
import type { OpsBoardStaffRow } from "@/hooks/useOpsBoard";
import type { BoardOrder } from "@/lib/orderTypes";
import { formatPaymentLabel } from "@/lib/paymentLabel";
import {
  cardChipText,
  cardClock,
  elapsedSinceReceived,
  formatClockSpan,
  formatTimeOfDay,
} from "@/lib/opsClock";
import { OpsCardClock } from "./OpsCardClock";
import { OpsCardActions, type OpsActionHandlers } from "./OpsCardActions";

/**
 * One order, as a card on the counter's board.
 *
 * The card is the whole product: colour first, words second, one tap third.
 * Three rules from docs/briefs/PHASE_N_OPERATIONS_CENTRE.md are structural
 * here rather than decorative, and each exists because of a measured failure:
 *
 *  1. Every state has a CHIP with words and an icon as well as a colour. The
 *     colour is the glance; the chip is what survives a colour-blind operator,
 *     a sunlit screen and a screen reader.
 *  2. The card body is a solid `bg-card` with full-strength text. No gradient
 *     (axe cannot measure contrast over one and reports `color-contrast` as
 *     *incomplete*, which is how GAP-U5-04 hid for so long — finding G13), no
 *     tinted body behind muted text (4.24:1, finding G14), no `opacity` on any
 *     text.
 *  3. Only the 6px band, the chip and the clock carry state. Everything else
 *     on the card looks identical whatever is happening to the order, so a
 *     glance down a lane compares like with like.
 *
 * `data-state`, `data-lane` and `data-alert` are the contract the journey and
 * a11y suites assert against. `data-alert` (N4a introduced `alertActive` as a
 * stub that was always "false"; N5b wired it to `useOpsAlerts`, which reads
 * real `ops_alerts` rows pushed over `opsBus` — it is live) is a
 * pulse-and-chime trigger, never a colour: the band and chip above already
 * say what STATE the card is in, and an alert is an orthogonal fact — "this
 * needs someone's attention now" — that can be true or false in almost any
 * state.
 *
 * Every action beyond View/Details moved to `OpsCardActions.tsx` (N4a): claim,
 * pass, ready, arrived, out for delivery, undo, hold, delay, set due and rate,
 * every one wired to `POST /api/orders/:id/transition` (or, for a delay and a
 * rating, the path the brief keeps those two on). This file keeps the parts
 * that answer "what state is this and what does it say", not "what can I do
 * about it".
 */

interface StateStyle {
  /** The 6px band across the top — the state's primary signal. */
  band: string;
  /** Chip fill + text. Every pair is proven >= 4.5:1 in shared/ui/contrast.spec.ts. */
  chip: string;
  icon: LucideIcon;
  /** Held cards are outlined rather than filled (brief, "Colour resolution"). */
  cardOutline?: string;
}

const STATE_STYLES: Record<CardState, StateStyle> = {
  completed: {
    band: "bg-ops-completed",
    chip: "bg-ops-completed text-ops-completed-foreground",
    icon: Check,
  },
  // Yesterday's and tomorrow's cards are deliberately colourless: they are not
  // being worked now, and a coloured band on one competes with the orders that
  // are.
  "carried-over": { band: "bg-muted", chip: "bg-muted text-foreground", icon: Calendar },
  scheduled: { band: "bg-muted", chip: "bg-muted text-foreground", icon: CalendarClock },
  held: {
    band: "bg-muted",
    chip: "bg-ops-held text-ops-held-foreground",
    icon: Pause,
    cardOutline: "border-dashed border-truth-bright",
  },
  "customer-waiting": {
    band: "bg-ops-late",
    chip: "bg-ops-late text-ops-late-foreground",
    icon: BellRing,
  },
  late: { band: "bg-ops-late", chip: "bg-ops-late text-ops-late-foreground", icon: AlertTriangle },
  delayed: {
    band: "bg-ops-delayed",
    chip: "bg-ops-delayed text-ops-delayed-foreground",
    icon: Clock,
  },
  ready: { band: "bg-ops-ready", chip: "bg-ops-ready text-ops-ready-foreground", icon: Check },
  "due-soon": { band: "bg-ops-ontime", chip: "bg-ops-ontime text-truth-foreground", icon: Clock },
  "on-time": { band: "bg-ops-ontime", chip: "bg-ops-ontime text-truth-foreground", icon: Clock },
};

export interface OpsCardProps extends OpsActionHandlers {
  order: BoardOrder;
  derived: DerivedCardState;
  now: Date;
  settings: OpsTimingSettings;
  /** MANAGER+ gets Edit and Delete; a cashier never sees a control that would 403. */
  role?: string;
  currentUserId?: string;
  staff: OpsBoardStaffRow[];
  /** True while this card's own write is in flight. */
  busy?: boolean;
  /** Set while the board is stale or offline — every write is refused, with a reason. */
  blockedReason?: string | null;
  /** True while an open alert addressed to the viewer exists on this card (N5b — live, via `useOpsAlerts`). */
  alertActive?: boolean;
  /** Enter on a focused card, unless a barcode scanner sent it (client/src/lib/opsKeys.ts). */
  shouldIgnoreEnter?: (at: number) => boolean;
}

function OpsCardInner({
  order,
  derived,
  now,
  settings,
  role,
  currentUserId,
  staff,
  busy,
  blockedReason,
  alertActive,
  shouldIgnoreEnter,
  onClaim,
  onUnclaim,
  onAssign,
  onReady,
  onUnready,
  onArrived,
  onOutForDelivery,
  onComplete,
  onReopen,
  onHold,
  onUnhold,
  onSetDue,
  onUrgent,
  onView,
  onEdit,
  onDelete,
}: OpsCardProps) {
  const style = STATE_STYLES[derived.state];
  const ChipIcon = style.icon;
  const clock = cardClock(order, derived, now, settings.timezone);
  const chipText = cardChipText(order, derived, now, settings.timezone);
  const elapsed = elapsedSinceReceived(derived, now);
  const isOpen = order.status !== "completed";
  const isHeld = order.status === "on-hold";
  const blocked = Boolean(blockedReason);
  const disabled = busy || blocked;
  const customer = order.customerName ?? "Walk-in";
  const dueText = derived.dueAt ? formatTimeOfDay(derived.dueAt, settings.timezone) : null;

  /** Enter on the card itself does what the primary button does. */
  const onCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter") return;
    if (event.target !== event.currentTarget) return; // a real control has focus
    // A keyboard-wedge scanner ends every scan with Enter, and the board is
    // the screen the scanner is used on (finding G15). A scan must never
    // complete an order.
    if (shouldIgnoreEnter?.(event.timeStamp)) {
      event.preventDefault();
      return;
    }
    if (disabled || !isOpen) return;
    event.preventDefault();
    if (isHeld) onUnhold(order);
    else if (!order.assignedUserId) onClaim(order);
    else if (!order.readyAt) onReady(order);
    else onComplete(order);
  };

  return (
    /* The card is a focus stop with its own Enter handler on purpose: the
       lanes are a roving-tabindex composite (brief, "Keyboard & focus"), so a
       keyboard user arrows between cards and presses Enter, instead of
       tabbing through five controls per card down a lane of thirty. Both
       rules below assume a document, not a board. */
    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */
    <article
      data-testid={`ops-card-${order.id}`}
      data-state={derived.state}
      data-lane={order.fulfilmentMethod}
      data-alert={alertActive ? "true" : "false"}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-label={`Order ${order.shortCode}, ${customer}`}
      onKeyDown={onCardKeyDown}
      className={cn(
        "relative overflow-hidden rounded-lg border border-border bg-card text-card-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-truth-bright",
        style.cardOutline,
        busy && "animate-pulse motion-reduce:animate-none",
        alertActive && "animate-ops-pulse motion-reduce:animate-none",
      )}
    >
      {/* The state band. 6px, full width, aria-hidden: the chip below says the
          same thing in words, and saying it twice to a screen reader is noise. */}
      <span className={cn("block h-1.5 w-full", style.band)} aria-hidden />

      <div className="space-y-2 p-3">
        {/* Chip and clock share the top line and wrap rather than clip: a lane
            is only ~290px wide when two of them sit beside the order form on a
            tablet, and a truncated "late by 53:0…" is the one number on the
            card that must never be cut. */}
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <span
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide",
              style.chip,
            )}
            data-testid={`ops-card-chip-${order.id}`}
          >
            <ChipIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {chipText}
          </span>
          <OpsCardClock clock={clock} className="whitespace-nowrap text-lg" />
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 text-base font-semibold leading-snug text-foreground">
            <span className="font-mono text-sm text-muted-foreground">#{order.shortCode}</span>{" "}
            {customer}
          </p>
          <p className="text-base font-semibold tabular-nums text-foreground">
            £{parseFloat(order.total || "0").toFixed(2)}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {formatPaymentLabel(order.paymentMethod)}
            </span>
          </p>
        </div>

        {/* The meta line answers "when is it for, where did it come from, who
            loaded it, when did it land" — 12px, weight 500, muted-foreground on
            the solid card (4.5:1+, never tinted). */}
        <p
          className={cn(
            "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-muted-foreground",
            // A middot between each fact rather than whitespace alone: at 12px
            // on a counter screen "Due 14:30 WhatsApp Loaded by Ana 12:07" runs
            // together into one string nobody can parse at a glance.
            "[&>span:not(:last-child)]:after:ml-2 [&>span:not(:last-child)]:after:content-['·']",
          )}
        >
          {dueText && <span>Due {dueText}</span>}
          <span className="inline-flex items-center gap-1">
            {isWebsiteOrder(order.channel) && <Globe2 className="h-3 w-3 shrink-0" aria-hidden />}
            {formatOrderChannel(order.channel)}
          </span>
          {order.inputUserName && <span>Loaded by {order.inputUserName}</span>}
          <span>In at {formatTimeOfDay(derived.receivedAt, settings.timezone)}</span>
          {elapsed && <span className="tabular-nums">{elapsed} here</span>}
        </p>

        {/* Where a live delivery goes (v1.2 Phase 5, Q8a): every member of
            staff sees it while the delivery is live; the card leaves the board
            when it is completed. No phone here: the assigned driver asks for
            it from the order's details, and that reveal is logged. */}
        {order.fulfilmentMethod === "delivery" && order.status !== "completed" && (order.deliveryAddress || order.deliveryPostcode) && (
          <p className="flex items-start gap-1.5 text-xs text-foreground" data-testid={`ops-card-address-${order.id}`}>
            <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 break-words">
              {[order.deliveryAddress, order.deliveryPostcode].filter(Boolean).join(", ")}
            </span>
          </p>
        )}
        {order.fulfilmentMethod === "delivery" && order.status !== "completed" && order.deliveryIssue && (
          // My run's "Couldn't deliver" (v1.2): the note the driver left.
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400" data-testid={`ops-card-delivery-issue-${order.id}`}>
            {order.deliveryIssue}
          </p>
        )}

        {(derived.urgent ||
          derived.backdated ||
          order.awaitingCardPayment ||
          order.dateKind === "preorder" ||
          derived.pastDueWhileHeldOrReady ||
          (derived.state === "ready" && derived.customerHere)) && (
          <p className="flex flex-wrap items-center gap-1.5">
            {derived.urgent && (
              // Urgent is a priority badge and a sort key, never a colour:
              // the colours already mean something exact (brief, "Colour
              // resolution").
              <span
                className="rounded-md border border-border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground"
                data-testid={`ops-card-urgent-${order.id}`}
              >
                Urgent
              </span>
            )}
            {derived.backdated && (
              <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                Backdated
              </span>
            )}
            {order.awaitingCardPayment && <AwaitingCardBadge order={order} />}
            {order.dateKind === "preorder" && (
              <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                Pre-order
              </span>
            )}
            {derived.pastDueWhileHeldOrReady && (
              <span className="rounded-md bg-ops-late px-1.5 py-0.5 text-[11px] font-semibold text-ops-late-foreground">
                Past due {formatClockSpan(now.getTime() - derived.dueEffective.getTime())}
              </span>
            )}
            {derived.state === "ready" && derived.customerHere && (
              <span className="rounded-md bg-ops-late px-1.5 py-0.5 text-[11px] font-semibold text-ops-late-foreground">
                Customer here
              </span>
            )}
          </p>
        )}

        <OpsCardActions
          order={order}
          derived={derived}
          settings={settings}
          now={now}
          role={role}
          currentUserId={currentUserId}
          staff={staff}
          busy={busy}
          blockedReason={blockedReason}
          onClaim={onClaim}
          onUnclaim={onUnclaim}
          onAssign={onAssign}
          onReady={onReady}
          onUnready={onUnready}
          onArrived={onArrived}
          onOutForDelivery={onOutForDelivery}
          onComplete={onComplete}
          onReopen={onReopen}
          onHold={onHold}
          onUnhold={onUnhold}
          onSetDue={onSetDue}
          onUrgent={onUrgent}
          onView={onView}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </article>
  );
}

/**
 * Re-rendered once a second by the board's ticker, times however many cards
 * are on screen — so the comparison is explicit: only `now` and the order
 * itself normally change, and the handlers are stable callbacks from the page.
 */
export const OpsCard = memo(OpsCardInner);

/**
 * "Awaiting card payment" (v1.2 Stripe links). Sold, not paid: Stripe has not
 * confirmed the card link. Tapping it reopens the link (the QR, send it
 * again, or take another payment), so a sale left waiting at the till can be
 * finished from the board.
 */
function AwaitingCardBadge({ order }: { order: BoardOrder }) {
  const [open, setOpen] = useState(false);
  const { data: status } = useQuery<{ enabled: boolean; whatsapp: boolean }>({
    queryKey: ["/api/card-links/till"],
    staleTime: 5 * 60_000,
  });
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="rounded-md border border-warning px-1.5 py-0.5 text-[11px] font-semibold text-warning focus:outline-none focus-visible:ring-2 focus-visible:ring-metal-titanium"
        data-testid={`ops-card-awaiting-card-${order.id}`}
      >
        Awaiting card payment
      </button>
      {open && (
        <CardLinkDialog
          orderId={order.id}
          amount={Number(order.total) || 0}
          longLived={order.channel === "phone" || order.channel === "whatsapp"}
          whatsappAvailable={status?.whatsapp === true}
          hasCustomer={!!order.customerId}
          onFinished={() => setOpen(false)}
        />
      )}
    </>
  );
}
