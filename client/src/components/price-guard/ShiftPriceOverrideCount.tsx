/**
 * A cashier's own count of price overrides on their shift (v1.2 Phase 4,
 * PRC-09). Only the count: no money, no cost, nobody else's. Hidden at zero.
 */
export function ShiftPriceOverrideCount({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <>
      {" · price overrides "}
      <span className="font-medium text-foreground" data-testid="pos-my-price-overrides">
        {count}
      </span>
    </>
  );
}
