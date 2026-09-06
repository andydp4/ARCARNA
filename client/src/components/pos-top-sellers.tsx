/**
 * One-tap chips for the products that actually sell.
 *
 * The tile grid is gone: for a coded catalogue it was a scroll-hunt, and the
 * order-line editor won. What tiles were good at was the handful of items
 * that go through the till all day, so those keep a one-tap path here. The
 * server ranks by units sold over the last few weeks; the chips only show
 * products that are still in the loaded catalogue, so a chip can never add
 * something the till cannot see.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPosPrice, type PosProduct } from "@/components/pos-types";

export type TopSeller = { productId: string; units: number };

export type PosTopSellersProps = {
  products: PosProduct[];
  onAdd: (product: PosProduct) => void;
  disabled?: boolean;
  className?: string;
};

export function PosTopSellers({ products, onAdd, disabled = false, className }: PosTopSellersProps) {
  const { data: ranked = [] } = useQuery<TopSeller[]>({
    queryKey: ["/api/products/top-sellers"],
    staleTime: 5 * 60 * 1000,
  });

  const chips = useMemo(() => {
    if (ranked.length === 0 || products.length === 0) return [];
    const byId = new Map(products.map((p) => [p.id, p]));
    const out: PosProduct[] = [];
    for (const row of ranked) {
      const product = byId.get(row.productId);
      if (product) out.push(product);
    }
    return out;
  }, [ranked, products]);

  if (chips.length === 0) return null;

  return (
    <div className={cn("pos-top-sellers", className)} data-testid="pos-top-sellers">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-wide text-metal-muted">
        <Flame className="h-3.5 w-3.5" aria-hidden />
        Top sellers
      </div>
      {/* One row, scrolls sideways under the thumb. Wrapping would push the
          lines below the fold on a phone, which is the space this strip has
          to earn. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="list" aria-label="Top sellers">
        {chips.map((product) => {
          const out = product.stock <= 0;
          return (
            <button
              key={product.id}
              type="button"
              role="listitem"
              disabled={disabled || out}
              onClick={() => onAdd(product)}
              className={cn(
                "pos-chip flex min-h-[44px] shrink-0 flex-col items-start justify-center rounded-lg border px-3 py-1.5 text-left",
                "max-w-[11rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-metal-titanium",
                out ? "cursor-not-allowed opacity-50" : "active:scale-[0.98]",
              )}
              aria-label={`Add ${product.name}`}
              data-testid={`top-seller-${product.id}`}
            >
              <span className="w-full truncate text-sm font-medium text-metal-warm-white">{product.name}</span>
              <span className="text-xs text-metal-muted">
                {formatPosPrice(product)}
                {out ? " · out of stock" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
