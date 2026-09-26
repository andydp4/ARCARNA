import { belowFloorMessage } from "@shared/pricing/priceGuard";
import { checkCartLine } from "@/lib/priceGuard";
import type { OrderLine } from "@/components/pos-order-lines";

/**
 * Under an order line, once the cashier has left the price box (v1.2 Phase 4,
 * PRC-02). One amber line when the price is below the lowest price — there is
 * only one warning state, and it never mentions cost (owner Q4). A price more
 * than 3× list offers the likely intended price, with no flag.
 */
export function PriceGuardLineNote({
  line,
  index,
  onUsePrice,
}: {
  line: OrderLine;
  index: number;
  onUsePrice: (price: number) => void;
}) {
  // Still typing: the check runs on leaving the box, not on every keystroke.
  if (line.priceInput !== undefined) return null;
  const check = checkCartLine(line);
  if (!check) return null;
  if (check.kind === "below") {
    return (
      <p className="mt-1 px-1 text-xs text-amber-500" role="status" data-testid={`line-price-guard-${index}`}>
        {belowFloorMessage(check.floor)}
      </p>
    );
  }
  return (
    <p className="mt-1 px-1 text-xs text-metal-muted" role="status" data-testid={`line-price-did-you-mean-${index}`}>
      Did you mean{" "}
      <button
        type="button"
        className="font-medium text-metal-warm-white underline"
        onClick={() => onUsePrice(check.suggestion)}
        data-testid={`line-price-did-you-mean-use-${index}`}
      >
        £{check.suggestion.toFixed(2)}
      </button>
      ?
    </p>
  );
}
