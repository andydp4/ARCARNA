import { useState } from "react";
import {
  Check,
  ChevronDown,
  Edit2,
  Eye,
  MapPin,
  MoreVertical,
  Pause,
  Play,
  Star,
  Trash2,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleRank, type Role } from "@shared/rbac";
import type { DerivedCardState, OpsTimingSettings } from "@shared/orders/opsState";
import type { OpsBoardStaffRow } from "@/hooks/useOpsBoard";
import type { BoardOrder } from "@/lib/orderTypes";
import { formatTimeOfDay } from "@/lib/opsClock";
import { currentTradingDay, localInstantAt, shiftIsoDate } from "@shared/time/tradingDay";
import { OpsDelayInline } from "./OpsDelayInline";
import { OpsPassMenu } from "./OpsPassMenu";
import { OpsRateChips } from "./OpsRateChips";

/**
 * Every action a card can take, wired to the real transition endpoint.
 *
 * `OpsCard.tsx` (N1/N3a) drew the band, the chip and the clock and had exactly
 * two writes: complete and hold/resume, both through the v0 PATCH. This is
 * the rest of the lifecycle (`docs/briefs/PHASE_N_OPERATIONS_CENTRE.md`,
 * "Order lifecycle & timing model" and "Assignment, stations & presence") —
 * claim, pass, ready, arrived, out for delivery, undo, delay, set due, rate —
 * every one of them a call to `POST /api/orders/:id/transition`
 * (`server/services/orderTransitions.ts`, N3b) except the two the brief
 * explicitly keeps on their own paths: a delay is DECLARED through
 * `PATCH …/operations` (`OpsDelayInline`, unchanged from N1/N3a), and a
 * rating is not a lifecycle stage at all (`OpsRateChips`, `POST
 * /api/satisfaction`).
 *
 * The actual HTTP calls are not made here. `operations.tsx` owns one
 * `useMutation` against the transition endpoint — pending state, the 409
 * "someone got there first" toast, the stale/offline gate, and applying the
 * fresh row back into the board's own cache all live in exactly one place —
 * and hands this component plain callbacks (`OpsActionHandlers`), the same
 * shape `OpsLane`/`OpsBoard` already pass through as `cardHandlers`. This
 * component's only state is which of its OWN inline panels (pass, delay, set
 * due, hold reason, rate, an actual completion time) is open, and it is
 * scoped so at most one is ever visible on one card at a time.
 */

export interface OpsActionHandlers {
  onClaim(order: BoardOrder): void;
  onUnclaim(order: BoardOrder): void;
  onAssign(order: BoardOrder, userId: string): void;
  onReady(order: BoardOrder): void;
  onUnready(order: BoardOrder): void;
  onArrived(order: BoardOrder): void;
  onOutForDelivery(order: BoardOrder): void;
  onComplete(order: BoardOrder, actualAt?: string): void;
  onReopen(order: BoardOrder): void;
  onHold(order: BoardOrder, reason?: string): void;
  onUnhold(order: BoardOrder): void;
  onSetDue(order: BoardOrder, due: { dueInMinutes: number } | { dueTime: string }): void;
  onUrgent(order: BoardOrder): void;
  onView(orderId: string): void;
  onEdit(order: BoardOrder): void;
  onDelete(order: BoardOrder): void;
}

export interface OpsCardActionsProps extends OpsActionHandlers {
  order: BoardOrder;
  derived: DerivedCardState;
  settings: OpsTimingSettings;
  role?: string;
  currentUserId?: string;
  staff: OpsBoardStaffRow[];
  busy?: boolean;
  blockedReason?: string | null;
}

type Panel = "pass" | "delay" | "setDue" | "hold" | "rate" | "completeAt" | null;

interface PrimaryAction {
  label: string;
  icon: LucideIcon;
  testId: string;
  onClick: () => void;
}

const SET_DUE_CHIPS = [5, 10, 15, 30, 45, 60] as const;

function isManagerPlus(role: string | undefined): boolean {
  if (!role) return false;
  try {
    return roleRank(role as Role) >= roleRank("MANAGER");
  } catch {
    return false;
  }
}

/** "18:30" today, or tomorrow if that has already passed — see OpsDelayInline for the same rule. */
function isoFromWallClock(hhmm: string, timeZone: string): string | null {
  try {
    const today = currentTradingDay(timeZone);
    const instant = localInstantAt(today, hhmm.slice(0, 5), timeZone);
    if (instant.getTime() <= Date.now()) return instant.toISOString();
    return localInstantAt(shiftIsoDate(today, -1), hhmm.slice(0, 5), timeZone).toISOString();
  } catch {
    return null;
  }
}

export function OpsCardActions({
  order,
  derived,
  settings,
  role,
  currentUserId,
  staff,
  busy,
  blockedReason,
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
}: OpsCardActionsProps) {
  const [panel, setPanel] = useState<Panel>(null);
  const [holdReason, setHoldReason] = useState("");
  const [actualTime, setActualTime] = useState("");

  const disabled = Boolean(busy) || Boolean(blockedReason);
  const isOpen = order.status !== "completed";
  const isHeld = order.status === "on-hold";
  const isCollection = order.fulfilmentMethod === "collection";
  const isCarriedOver = derived.state === "carried-over";
  const isScheduled = derived.state === "scheduled";
  const canEditOrDelete = role !== "CASHIER";
  const managerPlus = isManagerPlus(role);
  const isAssignee = order.assignedUserId === currentUserId;
  // `assign` to someone else is MANAGER+; a cashier may only pass on an order
  // that is already theirs (RBAC table, brief § API) — an unassigned order
  // is claimed with "Take it", not assigned to a third party by a cashier who
  // was never on it.
  const canPass = isOpen && (managerPlus || isAssignee);
  const canUndo = order.status === "completed" && (managerPlus || order.completedUserId === currentUserId);
  // A completion the brief asks to be honest about: a carried-over order's
  // "now" is not when it was actually handed over, so completing one always
  // asks first rather than silently stamping the tap as the moment.
  const needsActualTimeConfirm = isCarriedOver;
  const completeLabel = order.fulfilmentMethod === "delivery" ? "Delivered" : "Handed over";

  const togglePanel = (next: Exclude<Panel, null>) => setPanel((current) => (current === next ? null : next));
  const closePanel = () => setPanel(null);

  const fireComplete = (actualAtIso?: string) => {
    onComplete(order, actualAtIso);
    closePanel();
    setActualTime("");
  };

  /**
   * The one primary button, decided by the order's stage — not memoized: this
   * is a handful of comparisons on values the card already has, cheaper than
   * the bookkeeping a `useMemo` dependency list would need to stay correct
   * every time a closure inside it captures `order` or a handler.
   */
  function computePrimary(): PrimaryAction | null {
    if (isScheduled) return null;
    if (!isOpen) {
      if (!canUndo) return null;
      return { label: "Undo", icon: Undo2, testId: `ops-undo-${order.id}`, onClick: () => onReopen(order) };
    }
    if (isHeld) {
      return { label: "Resume", icon: Play, testId: `ops-resume-${order.id}`, onClick: () => onUnhold(order) };
    }
    if (!order.assignedUserId) {
      return { label: "Take it", icon: Check, testId: `ops-claim-${order.id}`, onClick: () => onClaim(order) };
    }
    if (!order.readyAt) {
      return { label: "Ready", icon: Check, testId: `ops-ready-${order.id}`, onClick: () => onReady(order) };
    }
    if (!isCollection && !order.outForDeliveryAt) {
      return {
        label: "Out for delivery",
        icon: Truck,
        testId: `ops-out-${order.id}`,
        onClick: () => onOutForDelivery(order),
      };
    }
    // Ready (collection) or dispatched (delivery): the completion step.
    return {
      label: completeLabel,
      icon: Check,
      testId: `button-complete-order-${order.id}`,
      onClick: () => (needsActualTimeConfirm ? togglePanel("completeAt") : fireComplete()),
    };
  }

  const primary = computePrimary();

  // The walk-in rule (brief, "The idea, reviewed"): a fresh collection sale is
  // one tap on Handed over even before anyone has claimed or readied it, so a
  // coffee never becomes a three-tap card. Shown only when it is not already
  // what the primary button does.
  const showAlwaysVisibleComplete =
    isOpen && isCollection && !isHeld && !isScheduled && primary?.testId !== `button-complete-order-${order.id}`;

  const showArrived = isOpen && isCollection && !isHeld && !isScheduled && !order.customerArrivedAt;
  const showNotReady = isOpen && !isHeld && Boolean(order.readyAt);
  const showSetDue = isOpen && !isScheduled && order.etaGiven == null;
  const showDelay = isOpen && !isScheduled;
  const showRate = order.status === "completed";
  const showHoldReasonItem = isOpen && !isHeld && !isScheduled;
  const showResumeItem = isOpen && isHeld;

  return (
    <div className="space-y-2">
      {order.assignedUserId && (
        <p className="text-xs font-medium text-muted-foreground" data-testid={`ops-assignee-${order.id}`}>
          {isAssignee ? "You" : (order.assignedUserName ?? "Someone")} dealing
        </p>
      )}

      <div className="flex flex-wrap items-stretch gap-2">
        {/* `flex-none` rather than v0's `flex-1 sm:flex-none`: a card can now
            show the primary button, an always-visible Handed over, AND
            Customer here in the same row (brief, the walk-in rule), and
            two-plus `flex-1` siblings sharing that row compete for fractional
            leftover space — the fractional pixel widths that produces are a
            known trigger for axe-core's `elmPartiallyObscured` false
            positive on `color-contrast` at narrow widths, which is exactly
            what this change was made to stop rather than chase after the
            fact. Every button still wraps to its own line via `flex-wrap`
            when a row cannot fit them all; none of them need to stretch. */}
        {primary && (
          <Button
            size="touch"
            className="flex-none"
            onClick={primary.onClick}
            disabled={disabled}
            title={blockedReason ?? undefined}
            data-testid={primary.testId}
          >
            <primary.icon className="h-4 w-4 shrink-0" aria-hidden />
            {primary.label}
          </Button>
        )}

        {showAlwaysVisibleComplete && (
          <Button
            size="touch"
            variant="outline"
            className="flex-none"
            onClick={() => (needsActualTimeConfirm ? togglePanel("completeAt") : fireComplete())}
            disabled={disabled}
            title={blockedReason ?? undefined}
            data-testid={`button-complete-order-${order.id}`}
          >
            <Check className="h-4 w-4 shrink-0" aria-hidden />
            {completeLabel}
          </Button>
        )}

        {showArrived && (
          <Button
            size="touch"
            variant="outline"
            onClick={() => onArrived(order)}
            disabled={disabled}
            aria-label={`Customer here for order ${order.shortCode}`}
            title={blockedReason ?? undefined}
            data-testid={`ops-arrived-${order.id}`}
          >
            <MapPin className="h-4 w-4 shrink-0" aria-hidden />
            Customer here
          </Button>
        )}

        <Button
          size="touch"
          variant="outline"
          onClick={() => onView(order.id)}
          data-testid={`button-view-order-${order.id}`}
        >
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
          View
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="touch"
              variant="outline"
              className="px-0 sm:px-3"
              data-testid={`button-order-actions-${order.id}`}
              aria-label={`More actions for order ${order.shortCode}`}
            >
              <MoreVertical className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {canPass && isOpen && !isScheduled && (
              <DropdownMenuItem
                onClick={() => togglePanel("pass")}
                disabled={disabled}
                data-testid={`ops-pass-open-${order.id}`}
              >
                <ChevronDown className="mr-2 h-4 w-4" aria-hidden />
                Pass to…
              </DropdownMenuItem>
            )}
            {order.assignedUserId && isOpen && (isAssignee || managerPlus) && (
              <DropdownMenuItem
                onClick={() => onUnclaim(order)}
                disabled={disabled}
                data-testid={`ops-unclaim-${order.id}`}
              >
                Release
              </DropdownMenuItem>
            )}
            {showNotReady && (
              <DropdownMenuItem
                onClick={() => onUnready(order)}
                disabled={disabled}
                data-testid={`ops-unready-${order.id}`}
              >
                Not ready
              </DropdownMenuItem>
            )}
            {showHoldReasonItem && (
              <DropdownMenuItem
                onClick={() => togglePanel("hold")}
                disabled={disabled}
                data-testid={`ops-hold-${order.id}`}
              >
                <Pause className="mr-2 h-4 w-4" aria-hidden />
                Put on hold…
              </DropdownMenuItem>
            )}
            {showResumeItem && (
              <DropdownMenuItem
                onClick={() => onUnhold(order)}
                disabled={disabled}
                data-testid={`menu-resume-order-${order.id}`}
              >
                <Play className="mr-2 h-4 w-4" aria-hidden />
                Resume
              </DropdownMenuItem>
            )}
            {showDelay && (
              <DropdownMenuItem
                onClick={() => togglePanel("delay")}
                disabled={disabled}
                data-testid={`ops-delay-open-${order.id}`}
              >
                Delay…
              </DropdownMenuItem>
            )}
            {showSetDue && (
              <DropdownMenuItem
                onClick={() => togglePanel("setDue")}
                disabled={disabled}
                data-testid={`ops-set-due-open-${order.id}`}
              >
                Set due…
              </DropdownMenuItem>
            )}
            {isOpen && !isHeld && !isScheduled && order.status !== "urgent" && (
              <DropdownMenuItem
                onClick={() => onUrgent(order)}
                disabled={disabled}
                data-testid={`ops-urgent-${order.id}`}
              >
                Mark urgent
              </DropdownMenuItem>
            )}
            {showRate && (
              <DropdownMenuItem
                onClick={() => togglePanel("rate")}
                data-testid={`ops-rate-open-${order.id}`}
              >
                <Star className="mr-2 h-4 w-4" aria-hidden />
                Rate…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onView(order.id)} data-testid={`menu-details-${order.id}`}>
              <Eye className="mr-2 h-4 w-4" aria-hidden />
              Details, delay &amp; documents
            </DropdownMenuItem>
            {canEditOrDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onEdit(order)} data-testid="menu-edit-order">
                  <Edit2 className="mr-2 h-4 w-4" aria-hidden />
                  Edit lines
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(order)}
                  data-testid="menu-delete-order"
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                  Delete order…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {order.fulfilmentMethod === "delivery" && derived.onTheRoad && (
          <span className="inline-flex items-center gap-1 self-center text-xs font-medium text-muted-foreground">
            <Truck className="h-3.5 w-3.5" aria-hidden />
            Out for delivery
          </span>
        )}
      </div>

      {panel === "pass" && (
        <OpsPassMenu
          order={order}
          staff={staff}
          currentUserId={currentUserId}
          disabled={disabled}
          onAssign={(userId) => {
            onAssign(order, userId);
            closePanel();
          }}
          onCancel={closePanel}
        />
      )}

      {panel === "delay" && (
        <OpsDelayInline order={order} settings={settings} blockedReason={blockedReason} onSaved={closePanel} onCancel={closePanel} />
      )}

      {panel === "hold" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2" data-testid={`ops-hold-panel-${order.id}`}>
          <Input
            value={holdReason}
            onChange={(event) => setHoldReason(event.target.value)}
            placeholder="Why (optional)"
            className="min-h-11 flex-1"
            data-testid={`input-hold-reason-${order.id}`}
          />
          <Button
            size="touch"
            disabled={disabled}
            onClick={() => {
              onHold(order, holdReason.trim() || undefined);
              setHoldReason("");
              closePanel();
            }}
            data-testid={`button-confirm-hold-${order.id}`}
          >
            Hold
          </Button>
          <Button size="touch" variant="ghost" onClick={closePanel} data-testid={`button-hold-cancel-${order.id}`}>
            Cancel
          </Button>
        </div>
      )}

      {panel === "setDue" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2" data-testid={`ops-set-due-panel-${order.id}`}>
          {SET_DUE_CHIPS.map((minutes) => (
            <Button
              key={minutes}
              size="touch"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                onSetDue(order, { dueInMinutes: minutes });
                closePanel();
              }}
              data-testid={`chip-set-due-${order.id}-${minutes}`}
            >
              +{minutes} min
            </Button>
          ))}
          <Input
            type="time"
            className="min-h-11 w-32"
            disabled={disabled}
            data-testid={`input-set-due-time-${order.id}`}
            onChange={(event) => {
              const value = event.target.value;
              if (!/^\d{2}:\d{2}$/.test(value)) return;
              onSetDue(order, { dueTime: value });
              closePanel();
            }}
          />
          <Button size="touch" variant="ghost" onClick={closePanel} data-testid={`button-set-due-cancel-${order.id}`}>
            Cancel
          </Button>
        </div>
      )}

      {panel === "completeAt" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2" data-testid={`ops-complete-at-panel-${order.id}`}>
          <p className="w-full text-sm text-muted-foreground">
            {isCarriedOver ? "Handed over yesterday? When, actually?" : `When was it actually ${completeLabel.toLowerCase()}?`}
          </p>
          <Input
            type="time"
            className="min-h-11 w-32"
            value={actualTime}
            onChange={(event) => setActualTime(event.target.value)}
            placeholder={formatTimeOfDay(new Date(), settings.timezone)}
            data-testid={`input-complete-actual-time-${order.id}`}
          />
          <Button
            size="touch"
            disabled={disabled}
            onClick={() => {
              const iso = actualTime ? isoFromWallClock(actualTime, settings.timezone) : null;
              // Clamped to a sane range: never before the order was received,
              // never later than now — a typo must never write a future or
              // an impossible handover time (brief: "actualAt, ≥ receivedAt, ≤ now").
              const clamped = iso
                ? new Date(Math.min(Date.now(), Math.max(new Date(iso).getTime(), derived.receivedAt.getTime())))
                : null;
              fireComplete(clamped ? clamped.toISOString() : undefined);
            }}
            data-testid={`button-confirm-complete-at-${order.id}`}
          >
            Confirm
          </Button>
          <Button
            size="touch"
            variant="outline"
            disabled={disabled}
            onClick={() => fireComplete()}
            data-testid={`button-complete-now-${order.id}`}
          >
            Just now
          </Button>
          <Button size="touch" variant="ghost" onClick={closePanel} data-testid={`button-complete-at-cancel-${order.id}`}>
            Cancel
          </Button>
        </div>
      )}

      {panel === "rate" && (
        <div className="rounded-lg border border-border bg-card p-2">
          <OpsRateChips order={order} />
        </div>
      )}
    </div>
  );
}
