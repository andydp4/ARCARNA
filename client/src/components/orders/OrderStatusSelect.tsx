import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ORDER_STATUSES, type OrderStatus } from "@shared/schema";
import { STATUS_CONFIG } from "@/components/orders/statusConfig";

/**
 * Change an order's status where it is, in one interaction.
 *
 * Status used to be reachable only through a row's overflow menu, which opened
 * a modal containing a single dropdown and a confirm button — four
 * interactions and a context switch to make one choice. It also meant a row
 * never showed its status in words at all; the only cue was the colour of the
 * left border, which carries nothing for anyone who cannot separate those
 * hues, and nothing at all to a screen reader.
 *
 * That friction is not only irritating, it costs money. Completion is the
 * moment Arcarna counts an order as taken (see services/revenue.ts), so
 * anything that makes marking an order complete slow or easy to defer delays
 * the day's takings appearing.
 *
 * The selector is the whole control: choosing writes immediately. There is no
 * separate confirm, because a confirm step for a reversible, single-field
 * change buys nothing — the change is visible in the row the moment it lands,
 * and picking again corrects it.
 */
export type OrderStatusSelectProps = {
  status: string;
  onChange: (status: OrderStatus) => void;
  /** Held while a write is in flight so a row cannot queue two conflicting changes. */
  disabled?: boolean;
  /** Distinguishes this row's control for a screen reader, e.g. the order number. */
  label: string;
  className?: string;
  "data-testid"?: string;
};

export function OrderStatusSelect({
  status,
  onChange,
  disabled,
  label,
  className,
  "data-testid": testId,
}: OrderStatusSelectProps) {
  const current = STATUS_CONFIG[status as OrderStatus];
  const Icon = current?.icon;

  return (
    <Select
      value={status}
      onValueChange={(next) => {
        // Radix fires on re-select of the current value; writing then would
        // spend a request and an optimistic update to change nothing.
        if (next !== status) onChange(next as OrderStatus);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        // 44px is the project's touch target floor — these rows are worked on
        // a tablet on the counter, not a desktop.
        className={cn("min-h-[44px] w-full gap-2 sm:w-[11rem]", className)}
        aria-label={`Status for ${label}`}
        data-testid={testId}
      >
        {/* The dot carries the same colour the row's left border uses, so the
            two agree, but the label carries the meaning. */}
        <span className="flex min-w-0 items-center gap-2">
          {current && (
            <span
              className={cn("h-2 w-2 shrink-0 rounded-full", current.color)}
              aria-hidden
            />
          )}
          <SelectValue placeholder="Set status" />
        </span>
      </SelectTrigger>
      <SelectContent>
        {ORDER_STATUSES.map((option) => {
          const config = STATUS_CONFIG[option];
          const OptionIcon = config.icon;
          return (
            <SelectItem key={option} value={option} data-testid={`status-option-${option}`}>
              <span className="flex items-center gap-2">
                <OptionIcon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                {config.label}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
