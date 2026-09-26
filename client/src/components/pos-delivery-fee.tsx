import { Plus, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DELIVERY_FEE_MAX, formatDeliveryFee, readDeliveryFee } from "@shared/orders/deliveryFee";

/**
 * The delivery fee at the till (v1.2.1): one tap adds the org's fee at its
 * set price; the amount can be changed for this order, or the fee removed.
 * `value` is the typed amount, or null when no fee is on the order.
 */
export function PosDeliveryFee({
  value,
  onChange,
  name,
  defaultPrice,
  disabled,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  name: string;
  defaultPrice: number;
  disabled?: boolean;
}) {
  if (value === null) {
    return (
      <Button
        type="button"
        variant="outline"
        className="min-h-[44px] w-full justify-start gap-2"
        onClick={() => onChange(defaultPrice.toFixed(2))}
        disabled={disabled}
        data-testid="button-add-delivery-fee"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add {name.charAt(0).toLowerCase() + name.slice(1)} · {formatDeliveryFee(defaultPrice)}
      </Button>
    );
  }
  const check = readDeliveryFee(value, { fulfilmentMethod: "delivery" });
  return (
    <div className="rounded-lg border border-border p-3" data-testid="pos-delivery-fee">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor="delivery-fee-amount" className="flex items-center gap-2">
            <Truck className="h-4 w-4" aria-hidden />
            {name}
          </Label>
          <div className="relative mt-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-metal-muted">£</span>
            <Input
              id="delivery-fee-amount"
              inputMode="decimal"
              className="min-h-[44px] pl-7 tabular-nums"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              aria-invalid={!check.ok}
              data-testid="input-delivery-fee"
            />
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="min-h-[44px] min-w-[44px] gap-1"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label={`Remove the ${name.toLowerCase()}`}
          data-testid="button-remove-delivery-fee"
        >
          <X className="h-4 w-4" aria-hidden />
          Remove
        </Button>
      </div>
      {!check.ok ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {check.message}
        </p>
      ) : (
        <p className="mt-2 text-xs text-metal-muted">
          Charged on top of the goods and shown on its own line on the receipt. Up to £{DELIVERY_FEE_MAX.toFixed(2)}.
        </p>
      )}
    </div>
  );
}

/** The fee the till prices with: the typed amount when valid, else none. */
export function effectiveDeliveryFee(
  value: string | null,
  context: { fulfilmentMethod: string; isPersonalUse: boolean },
): number {
  if (value === null || context.fulfilmentMethod !== "delivery" || context.isPersonalUse) return 0;
  const check = readDeliveryFee(value, { fulfilmentMethod: "delivery" });
  return check.ok ? check.fee : 0;
}
