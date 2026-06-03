import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PosProduct {
  id: string;
  name: string;
  productId: string;
  defaultSalePrice: string | number;
  stock: number;
  stockLimit: number;
  barcode?: string | null;
}

function formatProductPrice(p: PosProduct) {
  const n =
    typeof p.defaultSalePrice === "string"
      ? parseFloat(p.defaultSalePrice) || 0
      : p.defaultSalePrice || 0;
  return `$${n.toFixed(2)}`;
}

function stockBadge(product: PosProduct) {
  const stockPercentage =
    product.stockLimit > 0 ? (product.stock / product.stockLimit) * 100 : 100;
  if (product.stock === 0) {
    return <Badge variant="destructive" className="text-xs">Out of Stock</Badge>;
  }
  if (stockPercentage <= 20) {
    return (
      <Badge variant="destructive" className="text-xs">
        Low ({product.stock})
      </Badge>
    );
  }
  if (stockPercentage <= 50) {
    return (
      <Badge variant="secondary" className="text-xs">
        {product.stock} left
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs">
      {product.stock} in stock
    </Badge>
  );
}

export type PosProductCardProps = {
  product: PosProduct;
  onAdd: (product: PosProduct) => void;
  disabled?: boolean;
};

function PosProductCardInner({ product, onAdd, disabled = false }: PosProductCardProps) {
  const inStock = product.stock > 0;
  const canAdd = inStock && !disabled;
  return (
    <Card
      className={cn(
        "pos-product-card focus:outline-none focus-visible:ring-2 focus-visible:ring-metal-titanium",
        canAdd ? "cursor-pointer" : "pos-product-card-disabled cursor-not-allowed"
      )}
      onClick={() => canAdd && onAdd(product)}
      data-testid={`product-card-${product.id}`}
    >
      <CardHeader className="px-3 pb-2 pt-3 sm:px-4 sm:pt-4">
        <CardTitle className="line-clamp-2 text-base font-semibold leading-tight text-metal-warm-white sm:text-lg">
          {product.name}
        </CardTitle>
        <div className="text-xs text-metal-muted">{product.productId}</div>
      </CardHeader>
      <CardContent className="px-3 pb-3 sm:px-4 sm:pb-4">
        <div className="pos-price mb-2 text-xl font-bold sm:text-2xl">
          {formatProductPrice(product)}
        </div>
        <div className="mb-2">{stockBadge(product)}</div>
        <p className="mb-3 text-xs text-metal-muted">
          {inStock ? "Use Add to include this item in the cart" : "Unavailable until stock is replenished"}
        </p>
        <Button
          size="sm"
          type="button"
          className={cn(
            "min-h-[44px] w-full font-medium",
            canAdd ? "lm-btn-metal" : "pointer-events-none opacity-50"
          )}
          disabled={!canAdd}
          onClick={(e) => {
            e.stopPropagation();
            if (canAdd) onAdd(product);
          }}
          data-testid={`add-product-${product.id}`}
          aria-label={`Add ${product.name} to cart`}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add
        </Button>
      </CardContent>
    </Card>
  );
}

/** Avoid re-rendering the full grid when only cart / checkout state changes. */
export const PosProductCard = memo(
  PosProductCardInner,
  (prev, next) =>
    prev.product === next.product &&
    prev.onAdd === next.onAdd &&
    prev.disabled === next.disabled
);
