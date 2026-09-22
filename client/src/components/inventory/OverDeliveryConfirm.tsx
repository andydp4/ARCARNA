import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { parseQuantityInput, roundQuantity } from "@shared/quantity";

type ReceiveLine = { remaining: number; received: string | undefined };

function excessOf(line: ReceiveLine): number {
  const received = parseQuantityInput(line.received ?? "");
  if (received === null) return 0;
  return Math.max(0, roundQuantity(received - line.remaining));
}

/** True when any line is being received above what is still outstanding on the order. */
export function hasOverDelivery(lines: ReceiveLine[]): boolean {
  return lines.some((line) => excessOf(line) > 0);
}

/**
 * Inline (not a second dialog — nested Radix dialogs fight over focus on
 * Android) confirmation that the supplier really sent more than was ordered.
 * The receive button stays disabled until it is ticked; the server then raises
 * the ordered quantity to match and audits it (goods_receipt.over_delivery_accepted).
 */
export function OverDeliveryConfirm({
  lines,
  confirmed,
  onConfirmedChange,
}: {
  lines: (ReceiveLine & { id: string; productName: string })[];
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
}) {
  const over = lines
    .map((line) => ({ ...line, excess: excessOf(line) }))
    .filter((line) => line.excess > 0);
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
          onCheckedChange={(v) => onConfirmedChange(v === true)}
          data-testid="checkbox-confirm-over-delivery"
        />
        <Label htmlFor="confirm-over-delivery" className="font-normal leading-snug">
          The supplier sent these extra units. Accept them and raise the order to match (this is
          recorded in the audit log).
        </Label>
      </div>
    </div>
  );
}
