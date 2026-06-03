import type { UseMutationResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  Receipt,
  Award,
  Star,
  Tag,
  X,
} from "lucide-react";
import type { PosProduct } from "@/components/pos-product-card";
import { ActionLoader } from "@/components/action-loader";
import type { TierProgress } from "@shared/loyalty/progress";

export interface PosCartItem {
  product: PosProduct;
  quantity: number;
  customPrice: number;
  subtotal: number;
  priceInput?: string;
  quantityInput?: string;
}

export interface PosCustomer {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  category: string;
  loyaltyPoints: number;
}

export type PosCartPanelProps = {
  cart: PosCartItem[];
  setCart: React.Dispatch<React.SetStateAction<PosCartItem[]>>;
  cartItemCount: number;
  customers: PosCustomer[];
  filteredCustomers: PosCustomer[];
  customerSearch: string;
  setCustomerSearch: (v: string) => void;
  selectedCustomer: PosCustomer | null;
  setSelectedCustomer: (c: PosCustomer | null) => void;
  promoCode: string;
  setPromoCode: (v: string) => void;
  appliedPromo: { name?: string } | null;
  setAppliedPromo: (p: unknown) => void;
  validatePromoMutation: Pick<UseMutationResult<unknown, Error, string>, "mutate" | "isPending">;
  customerTier: {
    name?: string;
    discountPercentage?: string | number;
    pointsMultiplier?: number;
  } | null;
  loyaltyDiscount: number;
  subtotal: number;
  loyaltyDiscountAmount: number;
  promoDiscountAmount: number;
  tax: number;
  total: number;
  pointsEarned: number;
  tierProgress: TierProgress | null;
  minRedeemPoints: number;
  redeemPoints: number;
  pointsRedemptionAmount: number;
  onRedeemPointsClick: () => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, delta: number) => void;
  formatPrice: (p: PosProduct) => string;
  handleCheckout: () => void;
  orderSubmitting?: boolean;
};

/**
 * Module-level cart UI so React does not remount the whole panel on every POS render
 * (inline `const CartPanel = () => …` inside the page created a new component type each render).
 */
export function PosCartPanel({
  cart,
  setCart,
  cartItemCount,
  customers,
  filteredCustomers,
  customerSearch,
  setCustomerSearch,
  selectedCustomer,
  setSelectedCustomer,
  promoCode,
  setPromoCode,
  appliedPromo,
  setAppliedPromo,
  validatePromoMutation,
  customerTier,
  loyaltyDiscount,
  subtotal,
  loyaltyDiscountAmount,
  promoDiscountAmount,
  tax,
  total,
  pointsEarned,
  tierProgress,
  minRedeemPoints,
  redeemPoints,
  pointsRedemptionAmount,
  onRedeemPointsClick,
  removeFromCart,
  updateQuantity,
  formatPrice,
  handleCheckout,
  orderSubmitting = false,
}: PosCartPanelProps) {
  const { toast } = useToast();

  return (
    <>
      {cart.length > 0 ? (
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-metal-muted">Step 2 of 4 · Review cart</p>
      ) : (
        <p className="mb-3 text-sm leading-relaxed text-metal-muted">Add products from the grid to start a sale.</p>
      )}
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-metal-warm-white sm:text-xl">
          <ShoppingCart className="h-5 w-5 shrink-0" />
          Cart
          {cartItemCount > 0 && (
            <Badge variant="secondary" className="font-normal">
              {cartItemCount} {cartItemCount === 1 ? "item" : "items"}
            </Badge>
          )}
        </h2>
      </div>

      <div className="mb-4">
        <Select
          disabled={orderSubmitting}
          value={selectedCustomer?.id || "walk-in"}
          onValueChange={(value) => {
            if (value === "walk-in") {
              setSelectedCustomer(null);
              setPromoCode("");
              setAppliedPromo(null);
            } else {
              const customer = customers.find((c) => c.id === value);
              setSelectedCustomer(customer || null);
            }
          }}
        >
          <SelectTrigger data-testid="select-customer" className="min-h-[44px]">
            <SelectValue placeholder="Walk-in Customer" />
          </SelectTrigger>
          <SelectContent>
            <div className="p-2">
              <Input
                placeholder="Search customers..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="mb-2"
                disabled={orderSubmitting}
                data-testid="search-customer"
              />
            </div>
            <SelectItem value="walk-in">Walk-in Customer</SelectItem>
            {filteredCustomers.map((customer) => (
              <SelectItem key={customer.id} value={customer.id}>
                <div>
                  <div>{customer.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {customer.category} • {customer.loyaltyPoints} pts
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedCustomer && customerTier && (
          <Card className="lm-card-muted mt-2">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 pos-status-amber h-4 w-4" />
                  <span className="text-sm font-medium text-metal-warm-white">{customerTier.name} Member</span>
                </div>
                <Badge variant="outline">
                  <Star className="mr-1 h-3 w-3" />
                  {selectedCustomer.loyaltyPoints} pts
                </Badge>
              </div>
              <div className="mt-1 text-xs text-metal-muted">
                {customerTier.discountPercentage}% discount • {customerTier.pointsMultiplier}x points
              </div>
              {tierProgress?.nextTier && (
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-metal-muted mb-1">
                    <span>{tierProgress.pointsToNext} pts to {tierProgress.nextTier.name}</span>
                    <span>{tierProgress.percent}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-metal-surface overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-500/80 transition-all"
                      style={{ width: `${tierProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 w-full lm-btn-outline"
                disabled={
                  orderSubmitting ||
                  (selectedCustomer?.loyaltyPoints ?? 0) < minRedeemPoints
                }
                title={
                  (selectedCustomer?.loyaltyPoints ?? 0) < minRedeemPoints
                    ? `Need at least ${minRedeemPoints} points`
                    : undefined
                }
                onClick={onRedeemPointsClick}
              >
                Redeem points
                {redeemPoints > 0 ? ` (${redeemPoints} applied)` : ""}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {selectedCustomer && (
        <div className="mb-4">
          <div className="flex gap-2">
            <Input
              placeholder="Enter promo code..."
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              data-testid="input-promo-code"
              className="min-h-[44px]"
              disabled={orderSubmitting}
            />
            <Button
              variant="outline"
              onClick={() => {
                if (promoCode) {
                  validatePromoMutation.mutate(promoCode);
                }
              }}
              disabled={orderSubmitting || !promoCode || validatePromoMutation.isPending}
              data-testid="button-apply-promo"
              className="lm-btn-outline min-h-[44px] min-w-[44px]"
            >
              <Tag className="h-4 w-4" />
            </Button>
          </div>
          {appliedPromo && (
            <div className="mt-2 flex items-center justify-between lm-card-muted mt-2 flex items-center justify-between rounded-md p-2">
              <span className="text-sm text-metal-warm-white">{appliedPromo.name}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAppliedPromo(null);
                  setPromoCode("");
                }}
                data-testid="button-remove-promo"
                className="min-h-[44px] min-w-[44px]"
                disabled={orderSubmitting}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      <Separator className="mb-4" />

      <ScrollArea className="mb-4 flex-1">
        {cart.length === 0 ? (
          <div className="py-10 text-center text-metal-muted">
            <ShoppingCart className="mx-auto mb-2 h-12 w-12 opacity-40" />
            <p className="font-medium text-metal-warm-white">Your cart is empty</p>
            <p className="mt-1 text-sm">Tap a product to add it</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cart.map((item) => (
              <Card
                key={item.product.id}
                data-testid={`cart-item-${item.product.id}`}
                className="lm-card-muted overflow-hidden"
              >
                <CardContent className="p-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 font-medium">{item.product.name}</div>
                      <div className="text-xs text-metal-muted">
                        Default: {formatPrice(item.product)}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 min-h-[44px] min-w-[44px] shrink-0"
                      onClick={() => removeFromCart(item.product.id)}
                      data-testid={`remove-item-${item.product.id}`}
                      aria-label={`Remove ${item.product.name}`}
                      disabled={orderSubmitting}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="mb-3 flex items-center gap-2">
                    <Label className="shrink-0 text-xs">Price</Label>
                    <div className="flex items-center gap-1">
                      <span className="text-sm">$</span>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={item.priceInput ?? item.customPrice.toFixed(2)}
                        onChange={(e) =>
                          setCart((prev) =>
                            prev.map((cartItem) =>
                              cartItem.product.id === item.product.id
                                ? { ...cartItem, priceInput: e.target.value }
                                : cartItem
                            )
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        onBlur={(e) => {
                          const newPrice = parseFloat(e.target.value);
                          if (!isNaN(newPrice) && newPrice >= 0) {
                            setCart((prev) =>
                              prev.map((cartItem) =>
                                cartItem.product.id === item.product.id
                                  ? {
                                      ...cartItem,
                                      customPrice: newPrice,
                                      subtotal: cartItem.quantity * newPrice,
                                      priceInput: undefined,
                                    }
                                  : cartItem
                              )
                            );
                          } else {
                            setCart((prev) =>
                              prev.map((cartItem) =>
                                cartItem.product.id === item.product.id
                                  ? { ...cartItem, priceInput: undefined }
                                  : cartItem
                              )
                            );
                            toast({
                              title: "Invalid Price",
                              description: "Please enter a valid price",
                              variant: "destructive",
                            });
                          }
                        }}
                        className="h-10 min-h-[44px] w-24"
                        data-testid={`price-input-${item.product.id}`}
                        disabled={orderSubmitting}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1 rounded-md border border-metal-edge p-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 min-h-[44px] min-w-[44px]"
                        onClick={() => updateQuantity(item.product.id, -1)}
                        data-testid={`decrease-qty-${item.product.id}`}
                        aria-label="Decrease quantity"
                        disabled={orderSubmitting}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={item.quantityInput ?? item.quantity.toString()}
                        onChange={(e) =>
                          setCart((prev) =>
                            prev.map((cartItem) =>
                              cartItem.product.id === item.product.id
                                ? { ...cartItem, quantityInput: e.target.value }
                                : cartItem
                            )
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          if (raw === "") {
                            setCart((prev) =>
                              prev.map((cartItem) =>
                                cartItem.product.id === item.product.id
                                  ? { ...cartItem, quantityInput: undefined }
                                  : cartItem
                              )
                            );
                            return;
                          }
                          const newQty = parseInt(raw, 10);
                          if (Number.isNaN(newQty) || newQty < 1) {
                            setCart((prev) =>
                              prev.map((cartItem) =>
                                cartItem.product.id === item.product.id
                                  ? { ...cartItem, quantityInput: undefined }
                                  : cartItem
                              )
                            );
                            if (newQty === 0) removeFromCart(item.product.id);
                            else
                              toast({
                                title: "Invalid Quantity",
                                description: "Enter 1 or higher",
                                variant: "destructive",
                              });
                            return;
                          }
                          setCart((prev) =>
                            prev.map((cartItem) =>
                              cartItem.product.id === item.product.id
                                ? {
                                    ...cartItem,
                                    quantity: newQty,
                                    subtotal: newQty * cartItem.customPrice,
                                    quantityInput: undefined,
                                  }
                                : cartItem
                            )
                          );
                        }}
                        className="h-11 min-h-[44px] w-14 border-0 bg-transparent text-center font-medium focus-visible:ring-0"
                        data-testid={`qty-input-${item.product.id}`}
                        disabled={orderSubmitting}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 min-h-[44px] min-w-[44px]"
                        onClick={() => updateQuantity(item.product.id, 1)}
                        data-testid={`increase-qty-${item.product.id}`}
                        aria-label="Increase quantity"
                        disabled={orderSubmitting}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <span className="shrink-0 text-lg font-bold">${item.subtotal.toFixed(2)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </ScrollArea>

      <Card className="pos-summary-card mb-4">
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="text-sm font-medium text-metal-warm-white">Order Summary</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <div className="space-y-2 text-sm text-metal-warm-white">
            <div className="flex justify-between">
              <span className="text-metal-muted">Subtotal</span>
              <span data-testid="cart-subtotal">${subtotal.toFixed(2)}</span>
            </div>
            {loyaltyDiscountAmount > 0 && (
              <div className="pos-status-emerald flex justify-between">
                <span>Loyalty ({loyaltyDiscount}%)</span>
                <span data-testid="loyalty-discount">-${loyaltyDiscountAmount.toFixed(2)}</span>
              </div>
            )}
            {promoDiscountAmount > 0 && (
              <div className="pos-status-emerald flex justify-between">
                <span>Promo: {appliedPromo?.name}</span>
                <span data-testid="promo-discount">-${promoDiscountAmount.toFixed(2)}</span>
              </div>
            )}
            {pointsRedemptionAmount > 0 && (
              <div className="pos-status-emerald flex justify-between">
                <span>Points redeemed ({redeemPoints})</span>
                <span data-testid="points-redemption">-${pointsRedemptionAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-metal-muted">Tax (10%)</span>
              <span data-testid="cart-tax">${tax.toFixed(2)}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span data-testid="cart-total">${total.toFixed(2)}</span>
            </div>
            {selectedCustomer && pointsEarned > 0 && (
              <div className="border-t border-metal-edge pt-2 text-center text-xs text-metal-muted">
                <Award className="mr-1 inline h-3 w-3" />
                Earn {pointsEarned} loyalty points
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Button
        onClick={handleCheckout}
        disabled={cart.length === 0 || orderSubmitting}
        aria-label={
          cart.length === 0 ? "Checkout disabled – add items to cart" : "Proceed to checkout"
        }
        title={cart.length === 0 ? "Add items to cart" : undefined}
        className="lm-btn-metal min-h-[52px] w-full gap-2 text-base font-semibold"
        size="lg"
        data-testid="button-checkout"
      >
        {orderSubmitting ? (
          <>
            <ActionLoader className="text-primary-foreground" />
            Processing order…
          </>
        ) : (
          <>
            <Receipt className="h-5 w-5" />
            {cart.length === 0 ? "Add items to checkout" : "Checkout → Choose payment"}
          </>
        )}
      </Button>
    </>
  );
}
