import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  overDeliveredLines,
  overDeliveryKey,
  type ReceiveLine,
} from "@/lib/purchaseDraftEdits";

/**
 * Where a receive form stands on over-delivery: which lines exceed what is
 * outstanding, whether the manager's confirmation still covers exactly those
 * lines and quantities, and so which line ids may go to the server as
 * `acceptOverDeliveryLineIds`.
 *
 * `confirmedKey` is the overDeliveryKey the manager ticked against. Any change
 * to an over-delivered quantity, or another line going over, produces a
 * different key and the confirmation lapses by itself — it can never carry a
 * later typo or an unseen line through.
 */
export function overDeliveryState<T extends ReceiveLine>(lines: T[], confirmedKey: string | null) {
  const over = overDeliveredLines(lines);
  const key = overDeliveryKey(lines);
  const confirmed = over.length > 0 && confirmedKey === key;
  return {
    over,
    key,
    confirmed,
    /** True when the receive button must stay disabled. */
    blocked: over.length > 0 && !confirmed,
    acceptLineIds: confirmed ? over.map((line) => line.id) : [],
  };
}

/**
 * Inline (not a second dialog — nested Radix dialogs fight over focus on
 * Android) confirmation that the supplier really sent more than was ordered.
 * The server stores it per receipt line and raises the ordered quantity only
 * when the receipt is completed (migration 070), auditing it.
 */
export function OverDeliveryConfirm({
  lines,
  confirmedKey,
  onConfirmedKeyChange,
}: {
  lines: (ReceiveLine & { productName: string })[];
  confirmedKey: string | null;
  onConfirmedKeyChange: (key: string | null) => void;
}) {
  const { over, key, confirmed } = overDeliveryState(lines, confirmedKey);
  if (!over.length) return null;

  return (
    <div
      className="rounded border border-amber-500/40 bg-amber-500/10 p-3 space-y-2 text-sm"
      role="alert"
      data-testid="over-delivery-confirm"
    >
      <p className="font-medium">More than was ordered</p>
      <ul className="list-disc pl-5 space-y-0.5">
        {over.map((line) => (
          <li key={line.id}>
            {line.productName}: {line.excess} over the {line.remaining} still outstanding
          </li>
        ))}
      </ul>
      <div className="flex items-start gap-2">
        <Checkbox
          id="confirm-over-delivery"
          checked={confirmed}
          onCheckedChange={(v) => onConfirmedKeyChange(v === true ? key : null)}
          data-testid="checkbox-confirm-over-delivery"
        />
        <Label htmlFor="confirm-over-delivery" className="font-normal leading-snug">
          The supplier sent exactly these extra units. Accept them — the order is raised to match
          when this receipt is completed, and it is recorded in the audit log. Changing any of these
          quantities clears this tick.
        </Label>
      </div>
    </div>
  );
}
