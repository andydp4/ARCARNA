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
};

function PosProductCardInner({ product, onAdd }: PosProductCardProps) {
  const inStock = product.stock > 0;
  return (
    <Card
      className={cn(
        "transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        inStock
          ? "cursor-pointer hover:shadow-md hover:border-primary/30 active:scale-[0.98]"
          : "cursor-not-allowed opacity-75"
      )}
      onClick={() => inStock && onAdd(product)}
      data-testid={`product-card-${product.id}`}
    >
      <CardHeader className="px-3 pb-2 pt-3 sm:px-4 sm:pt-4">
        <CardTitle className="line-clamp-2 text-base font-semibold leading-tight sm:text-lg">
          {product.name}
        </CardTitle>
        <div className="text-xs text-muted-foreground">{product.productId}</div>
      </CardHeader>
      <CardContent className="px-3 pb-3 sm:px-4 sm:pb-4">
        <div className="mb-2 text-xl font-bold text-primary sm:text-2xl">
          {formatProductPrice(product)}
        </div>
        <div className="mb-2">{stockBadge(product)}</div>
        <Button
          size="sm"
          type="button"
          className={cn(
            "min-h-[44px] w-full font-medium",
            inStock ? "bg-primary hover:bg-primary/90" : "pointer-events-none opacity-50"
          )}
          onClick={(e) => {
            e.stopPropagation();
            if (inStock) onAdd(product);
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
    prev.onAdd === next.onAdd
);
