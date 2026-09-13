import { useEffect, useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateAfterOrderStatusChange } from "@/lib/query-invalidation";
import { DELAY_CAUSES } from "@shared/delayCauses";
import { localInstantAt, currentTradingDay, shiftIsoDate } from "@shared/time/tradingDay";
import type { OpsTimingSettings } from "@shared/orders/opsState";
import type { BoardOrder } from "@/lib/orderTypes";
import { formatTimeOfDay } from "@/lib/opsClock";

/**
 * Declaring — or clearing — a delay, from wherever the order already is.
 *
 * Card overflow's "Delay…" (`OpsCard.tsx`, N4a) and the details sheet's own
 * delay section (`OpsDetailsSheet.tsx`) are the SAME form, not two: both write
 * through `PATCH /api/orders/:id/operations` (kept, N3b-fixed — a delay is
 * declared, never computed, so it stays outside the transition endpoint's
 * twelve actions; `shared/orders/opsTransitions.ts`'s own `set_due` error
 * message says so explicitly). This was `OpsDetailsSheet.tsx`'s private
 * `OpsDelayEditor` in N1/N3a; N4a extracts it here so a card can open the same
 * editor without a Details tap first — declaring a delay is common enough on
 * a busy counter that routing it through "View → scroll → Delay" every time
 * would just teach staff to skip it, which is how the Delay Log went empty
 * for months in the first place (brief, finding G3).
 *
 * A revised time is resolved in the ORGANISATION's timezone, not the
 * tablet's: `localInstantAt` anchors "18:30" to the shop's trading day, so a
 * device left on the wrong zone can never promise a customer an hour that
 * never comes.
 */
export interface OpsDelayInlineProps {
  order: BoardOrder;
  settings: OpsTimingSettings;
  blockedReason?: string | null;
  /** Card overflow renders this inside a bordered panel; the details sheet already has one. */
  bordered?: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
}

export function OpsDelayInline({
  order,
  settings,
  blockedReason,
  bordered = true,
  onSaved,
  onCancel,
}: OpsDelayInlineProps) {
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
    setRevisedTime(order.revisedEta ? formatTimeOfDay(order.revisedEta, settings.timezone) : "");
    setCause("");
    setCustomerTold(false);
  }, [order.id, order.delayReason, order.revisedEta, settings.timezone]);

  const revisedIsoFromMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

  /**
   * "18:30" as an instant on the shop's trading day. A time that has already
   * passed today means the next one — a revised promise is always ahead, and
   * a shop open past midnight would otherwise be told 00:30 THIS morning. The
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
      onSaved?.();
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
    <div
      className={
        bordered ? "space-y-3 rounded-lg border border-border bg-card p-3" : "space-y-3"
      }
      data-testid={`ops-delay-editor-${order.id}`}
    >
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
            data-testid={`select-delay-cause-${order.id}`}
          >
            <SelectValue placeholder="Choose a cause" />
          </SelectTrigger>
          <SelectContent>
            {DELAY_CAUSES.map((option) => (
              <SelectItem key={option} value={option} data-testid={`delay-cause-${order.id}-${option}`}>
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
          data-testid={`input-delay-reason-${order.id}`}
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
              data-testid={`chip-delay-${order.id}-${minutes}`}
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
            data-testid={`input-delay-time-${order.id}`}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id={`ops-delay-told-${order.id}`}
          checked={customerTold}
          onCheckedChange={setCustomerTold}
          disabled={disabled}
          data-testid={`switch-customer-told-${order.id}`}
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
          data-testid={`button-save-delay-${order.id}`}
        >
          {saving ? "Saving…" : "Record delay"}
        </Button>
        {order.delayFlag && (
          <Button
            size="touch"
            variant="outline"
            disabled={disabled}
            onClick={() => save(null, true)}
            data-testid={`button-clear-delay-${order.id}`}
          >
            Clear delay
          </Button>
        )}
        {onCancel && (
          <Button size="touch" variant="ghost" disabled={saving} onClick={onCancel} data-testid={`button-delay-cancel-${order.id}`}>
            Close
          </Button>
        )}
      </div>
    </div>
  );
}
