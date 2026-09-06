/**
 * Order line entry — the order form.
 *
 * For a coded catalogue (`40410 3 MK`) a grid of tiles forces a scroll-hunt,
 * and because price and quantity were only editable in the cart, staff bounced
 * between the grid and checkout to correct a line. This is the one surface:
 * type a code or name, the product becomes a line, fix qty and price on the
 * line itself.
 *
 * Nothing here floats. The product picker used to be a popover, which on
 * Android sat in a portal fighting the on-screen keyboard and the page's
 * scroll lock, and sometimes simply did not appear. Its results now render
 * inline under the search box, in normal document flow, so the keyboard
 * pushes them up rather than covering them and there is no layer to fail.
 *
 * Behaviours that matter:
 * - the search box is at the top so it is reachable on a phone with the
 *   keyboard up, and it keeps focus after a pick so codes can be rattled in
 * - Enter picks the highlighted match; arrows move the highlight
 * - choosing a product already on a line bumps its quantity rather than
 *   creating a duplicate row
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Minus, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatQuantity, parseQuantityInput } from "@shared/quantity";
import { posPrice, type PosProduct } from "@/components/pos-types";

export interface OrderLine {
  product: PosProduct;
  quantity: number;
  customPrice: number;
  subtotal: number;
  priceInput?: string;
  quantityInput?: string;
}

export type PosOrderLinesProps = {
  products: PosProduct[];
  lines: OrderLine[];
  onChange: (next: OrderLine[]) => void;
  /** Shown under a line when the quantity exceeds what is in stock. */
  showStockWarnings?: boolean;
  disabled?: boolean;
  /** Rendered between the search box and the lines: the top-seller chips. */
  aboveLines?: React.ReactNode;
};

const MAX_RESULTS = 8;

function makeLine(product: PosProduct): OrderLine {
  const price = posPrice(product);
  return { product, quantity: 1, customPrice: price, subtotal: price };
}

/** Code, name and barcode all match; code and name matches rank first. */
export function searchProducts(products: PosProduct[], query: string, max = MAX_RESULTS): PosProduct[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts: PosProduct[] = [];
  const contains: PosProduct[] = [];
  for (const p of products) {
    const code = p.productId.toLowerCase();
    const name = p.name.toLowerCase();
    const barcode = (p.barcode ?? "").toLowerCase();
    if (code.startsWith(q) || name.startsWith(q) || (barcode && barcode === q)) starts.push(p);
    else if (code.includes(q) || name.includes(q) || (barcode && barcode.includes(q))) contains.push(p);
    if (starts.length >= max) break;
  }
  return [...starts, ...contains].slice(0, max);
}

/**
 * Inline type-ahead. An input and, directly beneath it, a listbox of matches.
 * No portal, no popover: the results are ordinary content.
 */
function ProductSearch({
  products,
  onPick,
  disabled,
  testId,
}: {
  products: PosProduct[];
  onPick: (product: PosProduct) => void;
  disabled?: boolean;
  testId: string;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const results = useMemo(() => searchProducts(products, query), [products, query]);
  useEffect(() => setActive(0), [query]);

  const pick = (product: PosProduct) => {
    onPick(product);
    setQuery("");
    // Keep the keyboard where it is: the next code goes straight in.
    inputRef.current?.focus();
  };

  return (
    <div className="pos-product-search">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-metal-muted" aria-hidden />
        <Input
          ref={inputRef}
          type="text"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
          aria-label="Add a product by code, name or barcode"
          placeholder="Add a product: code, name or barcode…"
          value={query}
          disabled={disabled}
          className="min-h-[48px] border-metal-edge bg-metal-charcoal pl-10 pr-10 text-base text-metal-warm-white placeholder:text-metal-muted"
          data-testid={testId}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (results.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(results[active] ?? results[0]);
            } else if (e.key === "Escape") {
              setQuery("");
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-metal-muted hover:text-metal-warm-white"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {query.trim() && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching products"
          className="pos-search-results mt-1 overflow-hidden rounded-lg border border-metal-edge"
          data-testid={`${testId}-results`}
        >
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-metal-muted" role="presentation">
              No product matches “{query.trim()}”.
            </li>
          ) : (
            results.map((product, index) => {
              const out = product.stock <= 0;
              return (
                <li
                  key={product.id}
                  id={`${listId}-${product.id}`}
                  role="option"
                  aria-selected={index === active}
                  aria-label={`${product.productId} ${product.name}`}
                  data-testid={`${testId}-option-${product.id}`}
                  className={cn(
                    "flex min-h-[48px] cursor-pointer items-center gap-3 px-3 py-2 text-sm",
                    index === active ? "bg-metal-surface" : "hover:bg-metal-surface/60",
                  )}
                  onMouseEnter={() => setActive(index)}
                  // pointerdown only keeps the input focused (a blur here would
                  // drop the keyboard and re-lay out the page under the
                  // finger). The pick itself waits for click, which a touch
                  // that turns into a scroll never produces — so dragging the
                  // list cannot add a product by accident.
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pick(product)}
                >
                  <span className="min-w-0 flex-1 truncate text-metal-warm-white">
                    <span className="font-mono text-xs text-metal-muted">{product.productId}</span>{" "}
                    {product.name}
                  </span>
                  <span className={cn("shrink-0 text-xs", out ? "text-amber-500" : "text-metal-muted")}>
                    £{posPrice(product).toFixed(2)} · {out ? "out of stock" : `${formatQuantity(product.stock)} in stock`}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

export function PosOrderLines({
  products,
  lines,
  onChange,
  showStockWarnings = true,
  disabled = false,
  aboveLines,
}: PosOrderLinesProps) {
  const update = (index: number, patch: Partial<OrderLine>) => {
    const next = lines.map((line, i) => {
      if (i !== index) return line;
      const merged = { ...line, ...patch };
      merged.subtotal = merged.quantity * merged.customPrice;
      return merged;
    });
    onChange(next);
  };

  const remove = (index: number) => onChange(lines.filter((_, i) => i !== index));

  const step = (index: number, delta: number) => {
    const line = lines[index];
    const quantity = Math.round((line.quantity + delta) * 1000) / 1000;
    if (quantity <= 0) return remove(index);
    update(index, { quantity, quantityInput: undefined });
  };

  const addProduct = (product: PosProduct) => {
    const existing = lines.findIndex((l) => l.product.id === product.id);
    if (existing >= 0) {
      update(existing, { quantity: lines[existing].quantity + 1, quantityInput: undefined });
      return;
    }
    onChange([...lines, makeLine(product)]);
  };

  return (
    <div className="space-y-3" data-testid="pos-order-lines">
      <ProductSearch products={products} onPick={addProduct} disabled={disabled} testId="line-product-new" />

      {aboveLines}

      {lines.length === 0 ? (
        <div className="pos-empty-state rounded-xl px-6 py-10 text-center">
          <p className="font-medium text-metal-warm-white">No lines yet</p>
          <p className="mt-1 text-sm text-metal-muted">Type a code or name above, scan a barcode, or tap a top seller.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Column headings, wide screens only — each row is self-labelling on a phone. */}
          <div className="hidden gap-2 px-2 text-xs uppercase tracking-wide text-metal-muted sm:grid sm:grid-cols-[1fr_9.5rem_6.5rem_5.5rem_2.75rem]">
            <span>Product</span>
            <span className="text-center">Qty</span>
            <span className="text-right">Price</span>
            <span className="text-right">Total</span>
            <span />
          </div>

          {lines.map((line, index) => {
            const overStock = line.quantity > line.product.stock;
            return (
              <div
                key={line.product.id}
                className="lm-card-muted rounded-lg p-2"
                data-testid={`order-line-${line.product.id}`}
              >
                <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-2 sm:grid-cols-[1fr_9.5rem_6.5rem_5.5rem_2.75rem]">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-metal-warm-white" data-testid={`line-name-${index}`}>
                      {line.product.name}
                    </div>
                    <div className="truncate font-mono text-xs text-metal-muted">{line.product.productId}</div>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 shrink-0 justify-self-end sm:order-last"
                    aria-label={`Remove ${line.product.name}`}
                    data-testid={`line-remove-${index}`}
                    disabled={disabled}
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>

                  <div className="flex items-center gap-1 rounded-md border border-metal-edge p-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10"
                      aria-label={`One less ${line.product.name}`}
                      disabled={disabled}
                      onClick={() => step(index, -1)}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      type="text"
                      // Decimal, not numeric: the numeric keypad has no decimal
                      // point, so a fractional quantity could not even be typed.
                      inputMode="decimal"
                      aria-label={`Quantity for ${line.product.name}`}
                      className="h-10 w-14 border-0 bg-transparent px-0 text-center font-medium focus-visible:ring-0"
                      value={line.quantityInput ?? formatQuantity(line.quantity)}
                      data-testid={`line-qty-${index}`}
                      disabled={disabled}
                      onChange={(e) => update(index, { quantityInput: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      onBlur={() => {
                        const parsed = parseQuantityInput(line.quantityInput ?? "");
                        update(index, { quantity: parsed ?? line.quantity, quantityInput: undefined });
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10"
                      aria-label={`One more ${line.product.name}`}
                      disabled={disabled}
                      onClick={() => step(index, 1)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-1">
                    <span className="text-sm text-metal-muted">£</span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Price for ${line.product.name}`}
                      className="h-10 w-24 sm:w-full"
                      value={line.priceInput ?? line.customPrice.toFixed(2)}
                      data-testid={`line-price-${index}`}
                      disabled={disabled}
                      onChange={(e) => update(index, { priceInput: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      onBlur={() => {
                        const parsed = parseFloat(line.priceInput ?? "");
                        const customPrice = Number.isFinite(parsed) && parsed >= 0 ? parsed : line.customPrice;
                        update(index, { customPrice, priceInput: undefined });
                      }}
                    />
                  </div>

                  <span
                    className="col-span-2 text-right text-base font-semibold tabular-nums text-metal-warm-white sm:col-span-1"
                    data-testid={`line-total-${index}`}
                  >
                    £{line.subtotal.toFixed(2)}
                  </span>
                </div>

                {showStockWarnings && overStock && (
                  <p className="mt-1 px-1 text-xs text-amber-500" data-testid={`line-warning-${index}`}>
                    Only {formatQuantity(line.product.stock)} in stock — this line will be held for review.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
