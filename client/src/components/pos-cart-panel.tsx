import { useEffect, useId, useRef, useState } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ShoppingCart,
  Receipt,
  Award,
  Star,
  Tag,
  X,
  UserPlus,
  ChevronDown,
} from "lucide-react";
import type { PosProduct } from "@/components/pos-types";
import { ActionLoader } from "@/components/action-loader";
import { NewCustomerDialog } from "@/components/customers/NewCustomerDialog";
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
  /** Undefined/true = the customer accepts a receipt email; false opts out. */
  receiptEmailOptIn?: boolean | null;
  category: string;
  loyaltyPoints: number;
}

/**
 * Inline customer picker. A trigger and, directly beneath it when open, a
 * search box and a listbox of matches. No portal, no popover — same reason
 * as ProductSearch in pos-order-lines.tsx: a floating menu built from a
 * listbox-style Select fights a search input placed inside it, and on
 * Android specifically, tapping the input to raise the keyboard closed the
 * whole menu before a customer could ever be searched for.
 */
function CustomerPicker({
  filteredCustomers,
  customerSearch,
  setCustomerSearch,
  selectedCustomer,
  setSelectedCustomer,
  disabled,
  onAddNew,
}: {
  filteredCustomers: PosCustomer[];
  customerSearch: string;
  setCustomerSearch: (v: string) => void;
  selectedCustomer: PosCustomer | null;
  setSelectedCustomer: (c: PosCustomer | null) => void;
  disabled?: boolean;
  onAddNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const closeIfOutside = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeIfOutside);
    return () => document.removeEventListener("pointerdown", closeIfOutside);
  }, [open]);

  const pick = (customer: PosCustomer | null) => {
    setSelectedCustomer(customer);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        data-testid="select-customer"
        aria-label="Customer"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className="flex min-h-[44px] w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">{selectedCustomer ? selectedCustomer.name : "Walk-in Customer"}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
      </button>

      {open && (
        <div
          className="pos-search-results absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-metal-edge bg-popover text-popover-foreground shadow-md"
        >
          <div className="p-2">
            <Input
              autoFocus
              placeholder="Search customers..."
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              disabled={disabled}
              data-testid="search-customer"
              aria-controls={listId}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>
          <ul id={listId} role="listbox" aria-label="Customers" className="max-h-64 overflow-y-auto">
            <li
              role="option"
              aria-selected={!selectedCustomer}
              className="flex min-h-[44px] cursor-pointer items-center px-3 py-2 text-sm hover:bg-metal-surface/60"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(null)}
            >
              Walk-in Customer
            </li>
            <li
              role="option"
              data-testid="select-customer-new"
              className="flex min-h-[44px] cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-metal-surface/60"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                // Not a selection — an action, and a different overlay
                // (NewCustomerDialog) is about to open. Let this one finish
                // closing first so the two never fight over focus.
                requestAnimationFrame(onAddNew);
              }}
            >
              <UserPlus className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
              Add a new customer
            </li>
            {filteredCustomers.map((customer) => (
              <li
                key={customer.id}
                role="option"
                aria-selected={selectedCustomer?.id === customer.id}
                className="flex min-h-[44px] cursor-pointer flex-col justify-center px-3 py-2 text-sm hover:bg-metal-surface/60"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(customer)}
              >
                <div>{customer.name}</div>
                <div className="text-xs text-muted-foreground">
                  {customer.category} • {customer.loyaltyPoints} pts
                </div>
              </li>
            ))}
            {/* A search that matches nobody is where a new customer is most
                likely to be standing. Say so rather than showing a blank list. */}
            {customerSearch.trim() && filteredCustomers.length === 0 && (
              <li role="presentation" className="px-2 py-3 text-center text-xs text-muted-foreground">
                No customer matches "{customerSearch.trim()}". Add them above.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export type PosCartPanelProps = {
  /** Only its length is read here (the checkout button's disabled state) — the
   *  line editor is `PosOrderLines` (pos.tsx), not this panel (N6). */
  cart: PosCartItem[];
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
  /** Org VAT/sales-tax rate as a percentage, for the label. */
  taxRatePercent?: number;
  total: number;
  pointsEarned: number;
  tierProgress: TierProgress | null;
  minRedeemPoints: number;
  redeemPoints: number;
  pointsRedemptionAmount: number;
  /** Whether the inline "points to redeem" panel is expanded (N6 — see the panel itself for why this is a `<div>`, not a `<Dialog>`). */
  redeemPanelOpen: boolean;
  redeemInput: string;
  setRedeemInput: (v: string) => void;
  onOpenRedeemPanel: () => void;
  onApplyRedeem: () => void;
  onCancelRedeem: () => void;
  handleCheckout: () => void;
  orderSubmitting?: boolean;
  /** Off when a sticky bar elsewhere on the page owns the checkout action. */
  showCheckoutButton?: boolean;
};

/**
 * Module-level cart UI so React does not remount the whole panel on every POS render
 * (inline `const CartPanel = () => …` inside the page created a new component type each render).
 *
 * Customer, discounts and totals only — the per-line cart editor this used to
 * carry (`variant="full"`, price/quantity inputs, a remove button per row) was
 * dead code once `pos.tsx` gained its own line editor (`PosOrderLines`) and
 * started passing `variant="summary"` on every call: nothing has passed
 * `"full"` since, so this panel now does only the one job it was actually
 * asked to do (Phase N, N6).
 */
export function PosCartPanel({
  cart,
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
  taxRatePercent,
  total,
  pointsEarned,
  tierProgress,
  minRedeemPoints,
  redeemPoints,
  pointsRedemptionAmount,
  redeemPanelOpen,
  redeemInput,
  setRedeemInput,
  onOpenRedeemPanel,
  onApplyRedeem,
  onCancelRedeem,
  handleCheckout,
  orderSubmitting = false,
  showCheckoutButton = true,
}: PosCartPanelProps) {
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);

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
          Order
          {cartItemCount > 0 && (
            <Badge variant="secondary" className="font-normal">
              {cartItemCount} {cartItemCount === 1 ? "item" : "items"}
            </Badge>
          )}
        </h2>
      </div>

      <div className="mb-4">
        <CustomerPicker
          filteredCustomers={filteredCustomers}
          customerSearch={customerSearch}
          setCustomerSearch={setCustomerSearch}
          selectedCustomer={selectedCustomer}
          setSelectedCustomer={(customer) => {
            setSelectedCustomer(customer);
            if (!customer) {
              setPromoCode("");
              setAppliedPromo(null);
            }
          }}
          disabled={orderSubmitting}
          onAddNew={() => setNewCustomerOpen(true)}
        />

        <NewCustomerDialog
          open={newCustomerOpen}
          onOpenChange={setNewCustomerOpen}
          initialName={customerSearch}
          onCreated={(customer) => {
            setSelectedCustomer(customer);
            setCustomerSearch("");
          }}
        />

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
                onClick={onOpenRedeemPanel}
                data-testid="button-redeem-points"
              >
                Redeem points
                {redeemPoints > 0 ? ` (${redeemPoints} applied)` : ""}
              </Button>

              {/* Inline, not a Dialog: on the Operations Centre's phone Order
                  tab this button is reachable with no board underneath it to
                  provide a modal a sensible place to land, and N6's DoD is
                  zero `role="dialog"` mounts on that screen regardless. Same
                  expand-in-place shape as `OpsDelayInline` and
                  `OpsCardActions`'s own panels. */}
              {redeemPanelOpen && (
                <div
                  className="mt-2 space-y-2 rounded-lg border border-border bg-card p-3"
                  data-testid="redeem-points-panel"
                >
                  <Label htmlFor="redeem-points-input" className="text-xs text-muted-foreground">
                    {selectedCustomer?.name ?? "This customer"} has {selectedCustomer?.loyaltyPoints ?? 0} points.
                    Minimum redemption: {minRedeemPoints} points.
                  </Label>
                  <Input
                    id="redeem-points-input"
                    type="number"
                    min={minRedeemPoints}
                    max={selectedCustomer?.loyaltyPoints ?? 0}
                    value={redeemInput}
                    onChange={(e) => setRedeemInput(e.target.value)}
                    className="min-h-11"
                    data-testid="input-redeem-points"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={onApplyRedeem} data-testid="button-apply-redeem">
                      Apply discount
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onCancelRedeem} data-testid="button-cancel-redeem">
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
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

      <Card className="pos-summary-card mb-4">
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="text-sm font-medium text-metal-warm-white">Order Summary</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <div className="space-y-2 text-sm text-metal-warm-white">
            <div className="flex justify-between">
              <span className="text-metal-muted">Subtotal</span>
              <span data-testid="cart-subtotal">£{subtotal.toFixed(2)}</span>
            </div>
            {loyaltyDiscountAmount > 0 && (
              <div className="pos-status-emerald flex justify-between">
                <span>Loyalty ({loyaltyDiscount}%)</span>
                <span data-testid="loyalty-discount">-£{loyaltyDiscountAmount.toFixed(2)}</span>
              </div>
            )}
            {promoDiscountAmount > 0 && (
              <div className="pos-status-emerald flex justify-between">
                <span>Promo: {appliedPromo?.name}</span>
                <span data-testid="promo-discount">-£{promoDiscountAmount.toFixed(2)}</span>
              </div>
            )}
            {pointsRedemptionAmount > 0 && (
              <div className="pos-status-emerald flex justify-between">
                <span>Points redeemed ({redeemPoints})</span>
                <span data-testid="points-redemption">-£{pointsRedemptionAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-metal-muted">Tax{taxRatePercent != null ? ` (${taxRatePercent}%)` : ""}</span>
              <span data-testid="cart-tax">£{tax.toFixed(2)}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span data-testid="cart-total">£{total.toFixed(2)}</span>
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

      {showCheckoutButton && (
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
            {cart.length === 0 ? "Add items to checkout" : "Checkout → Take payment"}
          </>
        )}
      </Button>
      )}
    </>
  );
}
