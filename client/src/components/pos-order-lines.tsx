/**
 * Order line entry grid — an alternative to the tile-tapping POS.
 *
 * Tiles suit a small fixed menu you tap by sight. For a coded catalogue
 * (`40410 3 MK`) they force a scroll-hunt, and because price and quantity are
 * only editable in the cart, staff end up bouncing between the grid and
 * checkout to correct a line.
 *
 * This edits the same `CartItem[]` the tile POS uses, so totals, tax, checkout
 * and order submission are untouched — only the entry surface differs.
 *
 * Behaviours that matter:
 * - the product field is a type-ahead, not a dropdown: a select is the same
 *   scroll problem in a smaller box once the catalogue grows
 * - the last row is always blank and choosing a product spawns the next, so
 *   there is no "add row" step
 * - Tab runs product → qty → price → next row
 */
import { useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { formatQuantity, parseQuantityInput } from "@shared/quantity";
import type { PosProduct } from "@/components/pos-product-card";

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
};

function priceOf(product: PosProduct): number {
  const raw = product.defaultSalePrice;
  const n = typeof raw === "string" ? parseFloat(raw) : raw;
  return Number.isFinite(n) ? Number(n) : 0;
}

function makeLine(product: PosProduct): OrderLine {
  const price = priceOf(product);
  return { product, quantity: 1, customPrice: price, subtotal: price };
}

/** Type-ahead product picker. Matches on name, SKU and barcode. */
function ProductPicker({
  products,
  value,
  onSelect,
  placeholder,
  testId,
}: {
  products: PosProduct[];
  value?: PosProduct;
  onSelect: (product: PosProduct) => void;
  placeholder: string;
  testId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-11 w-full justify-between font-normal"
          data-testid={testId}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? `${value.productId} · ${value.name}` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="liquid-metal w-[min(420px,90vw)] p-0" align="start">
        <Command
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Type a code or name…" data-testid={`${testId}-search`} />
          <CommandList>
            <CommandEmpty>No matching product.</CommandEmpty>
            <CommandGroup>
              {products.map((product) => (
                <CommandItem
                  key={product.id}
                  // Searched text: code, name and barcode all match.
                  value={`${product.productId} ${product.name} ${product.barcode ?? ""}`}
                  onSelect={() => {
                    onSelect(product);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value?.id === product.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex-1 truncate">
                    <span className="font-mono text-xs">{product.productId}</span> · {product.name}
                  </span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    £{priceOf(product).toFixed(2)} · {product.stock} in stock
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function PosOrderLines({
  products,
  lines,
  onChange,
  showStockWarnings = true,
}: PosOrderLinesProps) {
  const lastRowRef = useRef<HTMLDivElement | null>(null);

  const orderTotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.subtotal, 0),
    [lines],
  );

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

  const addProduct = (product: PosProduct) => {
    // Choosing a product a line already holds bumps its quantity rather than
    // creating a duplicate row.
    const existing = lines.findIndex((l) => l.product.id === product.id);
    if (existing >= 0) {
      update(existing, { quantity: lines[existing].quantity + 1, quantityInput: undefined });
      return;
    }
    onChange([...lines, makeLine(product)]);
  };

  return (
    <div className="space-y-2" data-testid="pos-order-lines">
      {/* Column headings, wide screens only — each row is self-labelling on mobile. */}
      <div className="hidden gap-2 px-1 text-xs uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[1fr_5rem_6rem_5rem_2.5rem]">
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
            <div className="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[1fr_5rem_6rem_5rem_2.5rem]">
              <ProductPicker
                products={products}
                value={line.product}
                placeholder="Choose product"
                testId={`line-product-${index}`}
                onSelect={(product) => update(index, { product, customPrice: priceOf(product) })}
              />

              <Input
                type="text"
                // Decimal, not numeric: the numeric keypad has no decimal point,
                // and parseInt("0.4") was 0 — between them a fractional quantity
                // could be neither typed nor entered.
                inputMode="decimal"
                aria-label={`Quantity for ${line.product.name}`}
                className="h-11 w-20 text-center sm:w-full"
                value={line.quantityInput ?? formatQuantity(line.quantity)}
                data-testid={`line-qty-${index}`}
                onChange={(e) => update(index, { quantityInput: e.target.value })}
                onBlur={() => {
                  const parsed = parseQuantityInput(line.quantityInput ?? "");
                  update(index, { quantity: parsed ?? line.quantity, quantityInput: undefined });
                }}
              />

              <div className="col-span-2 flex items-center gap-1 sm:col-span-1">
                <span className="text-sm text-muted-foreground sm:hidden">Price</span>
                <span className="text-sm">£</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Price for ${line.product.name}`}
                  className="h-11 flex-1"
                  value={line.priceInput ?? line.customPrice.toFixed(2)}
                  data-testid={`line-price-${index}`}
                  onChange={(e) => update(index, { priceInput: e.target.value })}
                  onBlur={() => {
                    const parsed = parseFloat(line.priceInput ?? "");
                    const customPrice =
                      Number.isFinite(parsed) && parsed >= 0 ? parsed : line.customPrice;
                    update(index, { customPrice, priceInput: undefined });
                  }}
                />
              </div>

              <span
                className="text-right font-semibold tabular-nums"
                data-testid={`line-total-${index}`}
              >
                £{line.subtotal.toFixed(2)}
              </span>

              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0 justify-self-end"
                aria-label={`Remove ${line.product.name}`}
                data-testid={`line-remove-${index}`}
                onClick={() => remove(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {showStockWarnings && overStock && (
              <p className="mt-1 px-1 text-xs text-amber-500" data-testid={`line-warning-${index}`}>
                Only {line.product.stock} in stock — this line will be held for review.
              </p>
            )}
          </div>
        );
      })}

      {/* Always-present blank row: choosing a product here appends the next line,
          so there is never an "add row" step. */}
      <div ref={lastRowRef} className="rounded-lg border border-dashed p-2">
        <ProductPicker
          products={products}
          placeholder="Add a product…"
          testId="line-product-new"
          onSelect={addProduct}
        />
      </div>

      <div className="flex items-center justify-between px-1 pt-1">
        <span className="text-sm text-muted-foreground">
          {lines.length} line{lines.length === 1 ? "" : "s"}
        </span>
        <span className="text-lg font-bold tabular-nums" data-testid="order-lines-subtotal">
          £{orderTotal.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
