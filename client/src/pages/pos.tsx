/**
 * The order form.
 *
 * Two steps, no pop-ups. Step 1 builds the order on the line editor: type a
 * code or name, scan a barcode, or tap a top seller, and fix quantity and
 * price on the line. Step 2 takes the payment on a full-screen step that
 * replaces the lines rather than floating over them.
 *
 * It used to be a tile grid, a cart in a slide-over sheet, and a checkout
 * dialog stacked on top of the sheet. On Android the stacked layers fought
 * over focus and scroll lock, the dialog was sized in vh so the keyboard
 * pushed its buttons off screen, and sometimes the dialog did not render at
 * all. Everything here is in normal page flow, and the only dialog left is
 * the small, single "Redeem loyalty points" one.
 *
 * Since N6 this also embeds beside the Operations Centre board
 * (`operations.tsx`'s form pane, and the phone's "New order" tab): pass
 * `embedded` and the shell fills its container (`h-full`) instead of the
 * standalone `.pos-viewport`, drops its own page header, and calls
 * `onPlaced` after every sale so the board can find and flash the new card.
 * `usePosNarrow` reads the form's OWN rendered width via a `@container` root
 * — not the browser viewport (`useIsMobile`, finding G18) — so the same
 * five structural branches and the same `@[640px]:` layout classes give the
 * phone structure to a ~460 px form pane on a 1194 px tablet exactly as they
 * do to a genuinely narrow phone screen. Standalone behaviour (`embedded`
 * omitted) is unchanged, because a standalone form's container is the
 * viewport.
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DEFAULT_TAX_RATE_PERCENT } from "@shared/tax";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { apiFetch } from "@/lib/appPaths";
import { offlineStorage } from "@/lib/offline-storage";
import { invalidateAfterPosCheckout } from "@/lib/query-invalidation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { PosOrderLines } from "@/components/pos-order-lines";
import { PosTopSellers } from "@/components/pos-top-sellers";
import { PosCheckoutStep, type OrderExpense, type TenderLeg } from "@/components/pos-checkout-step";
import { classifyOrderDate, localIsoDate } from "@shared/orders/orderDate";
import { posPrice, type PosProduct, type PosChannel } from "@/components/pos-types";
import { PosCartPanel, type PosCartPanelProps, type PosCartItem, type PosCustomer } from "@/components/pos-cart-panel";
import { ActionLoader } from "@/components/action-loader";
import { computeTierProgress } from "@shared/loyalty/progress";
import { consumeWhatsappDraft } from "@/lib/whatsappDraft";
import { Label } from "@/components/ui/label";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { playScanFailBeep, playScanSuccessBeep } from "@/lib/posAudio";
import { useAuth } from "@/hooks/useAuth";
import { usePosNarrow } from "@/hooks/usePosNarrow";
import type { LocationPickerOption } from "@shared/schema";
import type { GiftCardPaymentState } from "@/pages/pos/payments/GiftCardPayment";
import type { OpsBoardStaffRow } from "@/hooks/useOpsBoard";
import { cn } from "@/lib/utils";

type Product = PosProduct;
type Customer = PosCustomer;
type CartItem = PosCartItem;

export interface PosEmbeddedProps {
  /** Called after a sale places successfully, with the new order's id, so the
   *  board can scroll to and flash the card that just landed on it. */
  onPlaced: (orderId: string) => void;
}

export default function POS({ embedded }: { embedded?: PosEmbeddedProps } = {}) {
  const { toast } = useToast();
  const [narrowRef, narrow] = usePosNarrow();
  const [cart, setCart] = useState<CartItem[]>([]);
  /** Which step is on screen. "pay" replaces the lines with the payment step. */
  const [view, setView] = useState<"build" | "pay">("build");

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [personalUseReason, setPersonalUseReason] = useState("");
  // Split tender: a £100 sale taken as £50 cash and £50 on tick. Off by
  // default, because most sales are one tender and the extra controls would
  // just slow the till down.
  const [splitPayment, setSplitPayment] = useState(false);
  const [tenderLegs, setTenderLegs] = useState<TenderLeg[]>([
    { method: "cash", amount: "" },
    { method: "card", amount: "" },
  ]);
  // The day the order is for. Today unless the cashier says otherwise — a
  // missed day being keyed in afterwards, or a pre-order. Sent only when it is
  // not today, so an ordinary sale is dated by the server, in the org's zone.
  const [orderDate, setOrderDate] = useState<string>(() => localIsoDate());
  // Defaults to collection: the overwhelming majority of till sales are handed
  // over at the counter, so the common path stays a single tap.
  const [fulfilmentMethod, setFulfilmentMethod] = useState<"collection" | "delivery">("collection");
  const [giftCardPayment, setGiftCardPayment] = useState<GiftCardPaymentState | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<any>(null);
  const [loyaltyDiscount, setLoyaltyDiscount] = useState(0);
  const [customerTier, setCustomerTier] = useState<any>(null);
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [pointsRedemptionAmount, setPointsRedemptionAmount] = useState(0);
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);
  const [redeemInput, setRedeemInput] = useState("");
  const [orderExpenses, setOrderExpenses] = useState<OrderExpense[]>([]);
  const [expenseCategory, setExpenseCategory] = useState("shipping");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [emailReceipt, setEmailReceipt] = useState(false);

  // Fulfilment channel, the promise made to the customer, and who is dealing
  // with it — the board needs all three and, until N6, the form collected
  // none of them (brief, "Form embedding"; G20).
  const [channel, setChannel] = useState<PosChannel>("pos");
  const [dueMinutes, setDueMinutes] = useState<number | null>(null);
  const [dueTime, setDueTime] = useState("");
  // Once the cashier has picked (or explicitly cleared) a due time
  // themselves, the fulfilment/channel defaults below stop overwriting it.
  const [dueTouched, setDueTouched] = useState(false);
  // "" defers to the server's default-owner rule (inputter-if-on-station →
  // least-loaded present station member → Unassigned); a specific id is the
  // inputter's explicit override, sent as `assignedUserId`.
  const [assigneeUserId, setAssigneeUserId] = useState("");

  const { data: currentShiftData } = useQuery<{
    shift: { id: string; status: string; locationId?: string } | null;
  }>({
    queryKey: ["/api/shifts/current"],
    queryFn: async () => {
      const res = await apiFetch("/api/shifts/current", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load shift");
      return res.json();
    },
  });

  // Which location a sale actually lands in — mirrors requireOrgContext's own
  // fallback chain (open shift, then this user's default, then the org's
  // default active location) so the cashier sees it before hitting "Take
  // payment" rather than after, from a 400. No new endpoint: this is the same
  // /api/auth/user and /api/locations data other pages already fetch.
  const { user: authUser } = useAuth();
  const { data: posLocations = [] } = useQuery<LocationPickerOption[]>({
    queryKey: ["/api/locations"],
  });
  const orgDefaultLocation = posLocations.find((l) => l.isDefault === 1 && l.isActive === 1);
  const sellingLocationId =
    currentShiftData?.shift?.locationId ||
    (authUser as { defaultLocationId?: string | null } | null)?.defaultLocationId ||
    orgDefaultLocation?.id ||
    null;
  const sellingLocation = posLocations.find((l) => l.id === sellingLocationId) ?? null;
  // Only meaningful once locations have actually loaded — an empty list on
  // first render must not flash a false "no location configured" warning.
  const noLocationWillResolve = posLocations.length > 0 && !sellingLocationId;

  // "Looked after by" (brief, "Assignment") — the same staff list the board's
  // header strip uses, so the picker and the default-owner rule agree on who
  // is on shift.
  const { data: staffData } = useQuery<{ staff: OpsBoardStaffRow[] }>({
    queryKey: ["/api/operations/staff"],
  });
  const staff = staffData?.staff ?? [];

  useEffect(() => {
    if (selectedCustomer?.email && selectedCustomer.receiptEmailOptIn !== false) {
      setEmailReceipt(true);
    } else {
      setEmailReceipt(false);
    }
  }, [selectedCustomer?.id, selectedCustomer?.email, selectedCustomer?.receiptEmailOptIn]);

  // Fetch products
  const { data: products = [], isLoading: productsLoading } = useQuery<PosProduct[]>({
    queryKey: ["/api/products"],
  });

  // Fetch customers
  const { data: customers = [], isLoading: customersLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  // Consume a WhatsApp draft-order prefill once products + customers are loaded.
  const [draftConsumed, setDraftConsumed] = useState(false);
  useEffect(() => {
    if (draftConsumed || productsLoading || customersLoading) return;
    const draft = consumeWhatsappDraft();
    if (!draft) {
      setDraftConsumed(true);
      return;
    }
    const matched: CartItem[] = [];
    const unmatched: string[] = [];
    for (const item of draft.items) {
      const product = products.find(
        (p) => (item.sku && p.productId === item.sku) || (item.productId && p.productId === item.productId),
      ) as PosProduct | undefined;
      if (!product) {
        unmatched.push(item.name);
        continue;
      }
      const price = posPrice(product);
      const quantity = Math.max(1, item.quantity || 1);
      matched.push({ product, quantity, customPrice: price, subtotal: price * quantity });
    }
    if (matched.length > 0) setCart(matched);
    if (draft.customerId) {
      const customer = customers.find((c) => c.id === draft.customerId);
      if (customer) setSelectedCustomer(customer);
    }
    // The order came in over WhatsApp regardless of whether every line matched.
    setChannel("whatsapp");
    setDraftConsumed(true);
    toast({
      title: "WhatsApp draft loaded",
      description:
        matched.length > 0
          ? `${matched.length} item(s) added${unmatched.length ? `; ${unmatched.length} not matched` : ""}. Review before checkout.`
          : "No catalogue products matched the message. Add items manually.",
    });
  }, [draftConsumed, productsLoading, customersLoading, products, customers, toast]);

  // Tax rate must come from the org, not a constant: the till previously
  // showed 10% while the server charged 20%, so the customer was quoted one
  // total and charged another.
  const { data: orgSettings } = useQuery<{ vatEnabled?: boolean; vatRate?: number }>({
    queryKey: ["/api/settings"],
  });

  const { data: loyaltyTiers = [] } = useQuery<any[]>({
    queryKey: ["/api/loyalty-tiers"],
  });

  const { data: loyaltySettings } = useQuery<{ redemptionRate: number; minRedeemPoints: number }>({
    queryKey: ["/api/loyalty/settings"],
  });

  const tierProgress = useMemo(() => {
    if (!selectedCustomer || loyaltyTiers.length === 0) return null;
    return computeTierProgress(
      selectedCustomer.loyaltyPoints,
      loyaltyTiers.map((t: any) => ({
        name: t.name,
        pointsRequired: t.pointsRequired,
        color: t.color,
      })),
    );
  }, [selectedCustomer, loyaltyTiers]);

  // Filter customers for search
  const filteredCustomers = customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      (customer.phone && customer.phone.includes(customerSearch)) ||
      (customer.email && customer.email.toLowerCase().includes(customerSearch.toLowerCase()))
  );

  // Validate promo code mutation
  const validatePromoMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest("POST", "/api/promotions/validate", { code });
      return response.json();
    },
    onSuccess: (promo) => {
      setAppliedPromo(promo);
      toast({
        title: "Promo Applied",
        description: `${promo.name} applied successfully!`,
      });
    },
    onError: () => {
      toast({
        title: "Invalid Code",
        description: "The promo code is invalid or expired.",
        variant: "destructive",
      });
      setAppliedPromo(null);
    },
  });

  /** A single-tap way to add the promise a sale went out without (toast action below). */
  const setDueFromToastMutation = useMutation({
    mutationFn: async ({ orderId, minutes }: { orderId: string; minutes: number }) => {
      const res = await apiFetch(`/api/orders/${orderId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "set_due", dueInMinutes: minutes }),
      });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Due time set" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not set a due time", description: error.message, variant: "destructive" });
    },
  });

  // Place order mutation
  const placeOrderMutation = useMutation({
    mutationFn: async (orderData: any) => {
      const queueOffline = async () => {
        console.log('[POS] Queueing order mutation offline');
        try {
          await offlineStorage.queueMutation({
            type: 'ORDER_CREATE',
            method: 'POST',
            endpoint: '/api/orders',
            data: orderData,
          });
          console.log('[POS] Order mutation queued successfully');
        } catch (queueError) {
          console.error('[POS] Failed to queue mutation:', queueError);
          throw queueError;
        }

        return { offline: true, orderId: null };
      };

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await apiFetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderData),
          credentials: 'include',
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const text = await response.text() || response.statusText;
          if (response.status === 409 && text.includes("CASHIER_SHIFT_REQUIRED")) {
            // A readable toast rather than the raw response body (which is
            // what fell through to the generic `throw` below before N6) —
            // it used to also fire a CustomEvent for `CashierShiftBadge` to
            // catch, but that component was never mounted anywhere, so
            // nothing ever showed the cashier what had gone wrong.
            let message = "An active cashier shift is required before taking sales.";
            try {
              const parsed = JSON.parse(text);
              if (typeof parsed?.message === "string") message = parsed.message;
            } catch {
              /* the default message above already covers this */
            }
            throw new Error(message);
          }
          throw new Error(`${response.status}: ${text}`);
        }

        return response.json();
      } catch (error) {
        const isNetworkError = !navigator.onLine ||
          (error as Error).name === 'AbortError' ||
          (error as Error).message.includes('Failed to fetch') ||
          (error as Error).message.includes('NetworkError');

        if (isNetworkError) {
          return queueOffline();
        }
        throw error;
      }
    },
    onSuccess: async (data: any) => {
      const createdOrderId: string | undefined = data?.orderId ?? data?.order?.id;
      const hadNoDueTime = dueMinutes == null && !dueTime;

      if (data?.offline) {
        toast({
          title: "Order Saved Offline",
          description: "You're offline. Order will sync automatically when connection returns.",
        });
      } else if (data?.warnings && data.warnings.length > 0) {
        // Order was created but with stock warnings
        toast({
          title: "Order On Hold",
          description: data.warnings.join(". ") + ". Order has been placed on hold.",
          variant: "destructive",
          duration: 8000,
        });
      } else {
        toast({
          title: "Order Placed",
          description: "Order has been successfully processed.",
          ...(createdOrderId && hadNoDueTime
            ? {
                action: (
                  <ToastAction
                    altText="Set a due time"
                    onClick={() =>
                      setDueFromToastMutation.mutate({
                        orderId: createdOrderId,
                        minutes: fulfilmentMethod === "delivery" ? 45 : 30,
                      })
                    }
                  >
                    Set a due time?
                  </ToastAction>
                ),
              }
            : {}),
        });
      }

      if (createdOrderId && !data?.offline) {
        embedded?.onPlaced(createdOrderId);
      }

      setCart([]);
      setSelectedCustomer(null);
      setView("build");
      // Back to the default, or one delivery quietly marks every later sale on
      // this till as a delivery too.
      setFulfilmentMethod("collection");
      // Same reason: one backdated entry must not quietly date every later
      // sale on this till to last week.
      setOrderDate(localIsoDate());
      setOrderExpenses([]);
      setExpenseDescription("");
      setExpenseAmount("");
      setChannel("pos");
      setDueMinutes(null);
      setDueTime("");
      setDueTouched(false);
      setAssigneeUserId("");
      await invalidateAfterPosCheckout(queryClient);

      // The lines editor is back on screen the instant the mutation settles;
      // give it focus so the next code can be rattled straight in. Retried
      // for a moment rather than one `requestAnimationFrame`: the element is
      // briefly `disabled` (still `submitting` for the render or two this
      // reset and the query invalidation above take to land), and a browser
      // silently refuses to focus a disabled control — the retry is what
      // makes this land once it stops being disabled rather than racing it.
      const focusProductSearch = (attempt: number) => {
        const input = document.querySelector<HTMLInputElement>('[data-testid="line-product-new"]');
        if (input && !input.disabled) {
          input.focus();
          return;
        }
        if (attempt < 10) setTimeout(() => focusProductSearch(attempt + 1), 100);
      };
      focusProductSearch(0);
    },
    onError: (error: any) => {
      toast({
        title: "Order failed",
        description: error.message || "Failed to process the order",
        variant: "destructive",
      });
    },
  });

  // Adds a line, or bumps the quantity of the line the product is already on.
  // No toast: the line appearing in the editor is the confirmation.
  const addToCart = useCallback((product: Product) => {
    if (placeOrderMutation.isPending) return;
    const price = posPrice(product);

    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? {
                ...item,
                quantity: item.quantity + 1,
                subtotal: (item.quantity + 1) * item.customPrice,
              }
            : item
        );
      }
      return [
        ...prev,
        {
          product,
          quantity: 1,
          customPrice: price,
          subtotal: price,
        },
      ];
    });
  }, [placeOrderMutation.isPending]);

  const addProductByBarcode = useCallback(
    async (code: string) => {
      const localMatch = products.find((product) => product.barcode === code);
      if (localMatch) {
        addToCart(localMatch);
        playScanSuccessBeep();
        return;
      }

      try {
        const res = await apiFetch(`/api/products/by-barcode/${encodeURIComponent(code)}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Product not found");
        const product = (await res.json()) as Product;
        addToCart(product);
        playScanSuccessBeep();
      } catch {
        playScanFailBeep();
        toast({
          title: "Unknown barcode",
          description: `No product matched "${code}". Add it by name or code instead.`,
          variant: "destructive",
        });
      }
    },
    [products, addToCart, toast],
  );

  useBarcodeScanner((code) => {
    // A scan while taking payment is almost always the next customer's first
    // item. Bring the lines back rather than adding to an order being paid.
    if (view === "pay") setView("build");
    void addProductByBarcode(code);
  });

  // Update customer tier when customer is selected
  useEffect(() => {
    if (selectedCustomer && loyaltyTiers.length > 0) {
      const sortedTiers = [...loyaltyTiers].sort((a: any, b: any) => b.pointsRequired - a.pointsRequired);
      const tier = sortedTiers.find((t: any) => selectedCustomer.loyaltyPoints >= t.pointsRequired);
      setCustomerTier(tier);

      // Calculate loyalty discount based on tier
      if (tier) {
        setLoyaltyDiscount(parseFloat(tier.discountPercentage || 0));
      } else {
        setLoyaltyDiscount(0);
      }
    } else {
      setCustomerTier(null);
      setLoyaltyDiscount(0);
    }
  }, [selectedCustomer, loyaltyTiers]);

  useEffect(() => {
    setRedeemPoints(0);
    setPointsRedemptionAmount(0);
    setRedeemInput("");
  }, [selectedCustomer?.id]);

  // Suggested due time follows fulfilment/channel (brief: delivery pre-selects
  // +45, Phone/WhatsApp pre-select +30) until the cashier picks — or explicitly
  // clears — one themselves.
  useEffect(() => {
    if (dueTouched) return;
    setDueTime("");
    if (fulfilmentMethod === "delivery") {
      setDueMinutes(45);
    } else if (channel === "phone" || channel === "whatsapp") {
      setDueMinutes(30);
    } else {
      setDueMinutes(null);
    }
  }, [fulfilmentMethod, channel, dueTouched]);

  const selectDueMinutes = useCallback((minutes: number) => {
    setDueTouched(true);
    setDueTime("");
    setDueMinutes((current) => (current === minutes ? null : minutes));
  }, []);

  const selectDueTime = useCallback((time: string) => {
    setDueTouched(true);
    setDueMinutes(null);
    setDueTime(time);
  }, []);

  const clearDue = useCallback(() => {
    setDueTouched(true);
    setDueMinutes(null);
    setDueTime("");
  }, []);

  // Calculate totals with discounts
  const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  const loyaltyDiscountAmount = (subtotal * loyaltyDiscount) / 100;
  const promoDiscountAmount = appliedPromo ?
    (appliedPromo.type === 'percentage' ? (subtotal * parseFloat(appliedPromo.value)) / 100 : parseFloat(appliedPromo.value))
    : 0;
  const totalDiscount = loyaltyDiscountAmount + promoDiscountAmount + pointsRedemptionAmount;
  const discountedSubtotal = Math.max(0, subtotal - totalDiscount);
  // Mirrors the server: organizations.default_tax_rate, surfaced as vatRate.
  const taxRatePercent =
    orgSettings?.vatEnabled === false ? 0 : (orgSettings?.vatRate ?? DEFAULT_TAX_RATE_PERCENT);
  const tax = +(discountedSubtotal * (taxRatePercent / 100)).toFixed(2);
  const total = +(discountedSubtotal + tax).toFixed(2);

  // Calculate loyalty points earned (1 point per dollar spent, with tier multiplier)
  const pointsEarned = Math.floor(total * (customerTier?.pointsMultiplier || 1));

  // What is still to be taken on a split payment. Negative means over-tendered.
  const splitRemaining =
    Math.round(
      (total -
        tenderLegs.reduce((sum, leg) => sum + (Number(leg.amount) || 0), 0)) *
        100,
    ) / 100;

  // Total item count (sum of quantities)
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // A pre-order (dated ahead) always needs a promise (brief, "Pre-orders") —
  // recomputed reactively so the payment step's hint and the guard below
  // agree with whatever `orderDate` is showing right now.
  const isPreorderDate = useMemo(() => {
    const verdict = classifyOrderDate(orderDate, localIsoDate());
    return verdict.ok && verdict.dating.kind === "preorder";
  }, [orderDate]);

  // Handle checkout: move to the payment step.
  const handleCheckout = useCallback(() => {
    if (placeOrderMutation.isPending) return;
    if (cart.length === 0) {
      toast({
        title: "Nothing on the order",
        description: "Add at least one line before taking payment",
        variant: "destructive",
      });
      return;
    }
    setView("pay");
  }, [cart.length, placeOrderMutation.isPending, toast]);

  // Add expense to order
  const addExpense = () => {
    if (!expenseDescription || !expenseAmount) {
      toast({
        title: "Missing Information",
        description: "Please enter expense description and amount",
        variant: "destructive",
      });
      return;
    }

    const amount = parseFloat(expenseAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount",
        variant: "destructive",
      });
      return;
    }

    setOrderExpenses([...orderExpenses, {
      category: expenseCategory,
      description: expenseDescription,
      amount
    }]);

    // Reset form
    setExpenseDescription("");
    setExpenseAmount("");

    toast({
      title: "Expense Added",
      description: `Added ${expenseCategory} expense: £${(isNaN(amount) ? 0 : amount).toFixed(2)}`,
    });
  };

  // Remove expense from order
  const removeExpense = (index: number) => {
    setOrderExpenses(orderExpenses.filter((_, i) => i !== index));
  };

  // Process payment
  const processPayment = () => {
    if (cart.length === 0) {
      toast({
        title: "Nothing on the order",
        description: "Add at least one line before taking payment",
        variant: "destructive",
      });
      return;
    }
    if (placeOrderMutation.isPending) {
      toast({
        title: "Processing",
        description: "Please wait, order is being processed...",
        variant: "default",
      });
      return;
    }

    // Validate order expenses
    const totalExpenses = orderExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    if (totalExpenses > total) {
      toast({
        title: "Invalid Expenses",
        description: "Order expenses cannot exceed order total",
        variant: "destructive",
      });
      return;
    }

    if (paymentMethod === "gift_card") {
      if (!giftCardPayment?.code || giftCardPayment.amountToApply <= 0) {
        toast({ title: "Gift card required", description: "Look up a gift card and enter an amount to apply", variant: "destructive" });
        return;
      }
      const remainder = Math.round((total - giftCardPayment.amountToApply) * 100) / 100;
      if (remainder > 0.01 && !giftCardPayment.remainderPaymentMethod) {
        toast({ title: "Remainder payment required", description: "Choose how to pay the remaining balance", variant: "destructive" });
        return;
      }
    }

    // Checked here as well as on the server, so a date outside the window is
    // caught before the sale is sent rather than after the cashier thinks it
    // went through.
    const today = localIsoDate();
    const dateVerdict = classifyOrderDate(orderDate, today);
    if (!dateVerdict.ok) {
      toast({ title: "Check the order date", description: dateVerdict.message, variant: "destructive" });
      return;
    }

    // A pre-order with no promise is refused server-side too (every path,
    // including the website) — said here before the round trip rather than
    // after it.
    if (isPreorderDate && dueMinutes == null && !dueTime) {
      toast({
        title: "Set a due time",
        description: "Pre-orders need a due time before payment.",
        variant: "destructive",
      });
      return;
    }

    const orderData: any = {
      lines: cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        unitPrice: item.customPrice,
      })),
      paymentMethod: paymentMethod,
      fulfilmentMethod,
      channel,
      // Omitted for today: the server dates a live sale itself, in the org's
      // own timezone, so a till and a server either side of midnight cannot
      // disagree about which day "today" is.
      ...(dateVerdict.dating.kind !== "live" ? { orderDate: dateVerdict.dating.date } : {}),
    };
    if (dueTime) {
      orderData.dueTime = dueTime;
    } else if (dueMinutes != null) {
      orderData.dueInMinutes = dueMinutes;
    }
    if (assigneeUserId) {
      orderData.assignedUserId = assigneeUserId;
    }
    if (orderExpenses.length > 0) {
      orderData.expenses = orderExpenses;
    }
    if (splitPayment) {
      const legs = tenderLegs
        .map((leg) => ({ method: leg.method, amount: Number(leg.amount) }))
        .filter((leg) => Number.isFinite(leg.amount) && leg.amount > 0);
      if (legs.length === 0) {
        toast({
          title: "Enter how it was paid",
          description: "A split payment needs at least one amount.",
          variant: "destructive",
        });
        return;
      }
      const legTotal = Math.round(legs.reduce((sum, leg) => sum + leg.amount, 0) * 100) / 100;
      // Checked here as well as on the server: a cashier who is a few pence out
      // should find out at the till, not after the sale is recorded.
      if (Math.abs(legTotal - total) > 0.005) {
        toast({
          title: "The split does not add up",
          description: `Payments come to £${legTotal.toFixed(2)}, the order is £${total.toFixed(2)}.`,
          variant: "destructive",
        });
        return;
      }
      orderData.payments = legs;
    }
    if (paymentMethod === "personal_use") {
      // Guarded here as well as on the server, so the cashier is told before
      // the request rather than after.
      if (personalUseReason.trim().length < 3) {
        toast({
          title: "Say what this is for",
          description: "Personal use needs a reason before it can be recorded.",
          variant: "destructive",
        });
        return;
      }
      orderData.personalUseReason = personalUseReason.trim();
    }
    if (paymentMethod === "gift_card" && giftCardPayment) {
      orderData.giftCardCode = giftCardPayment.code;
      orderData.giftCardAmount = giftCardPayment.amountToApply;
      if (giftCardPayment.remainderPaymentMethod) orderData.remainderPaymentMethod = giftCardPayment.remainderPaymentMethod;
    }

    // Credit needs someone to collect it from. Guarded here as well as on the
    // server, so the cashier finds out before the sale goes through rather
    // than after — a tick sale with no customer used to open a debt that
    // silently dropped off the credit list because that list only ever shows
    // customers, and nobody could see or chase it.
    const usesCredit =
      paymentMethod === "tick" ||
      (Array.isArray(orderData.payments) &&
        orderData.payments.some((leg: { method: string }) => leg.method === "tick"));
    if (usesCredit && !selectedCustomer?.id) {
      toast({
        title: "Select a customer",
        description: "A sale on credit needs a customer to put it against.",
        variant: "destructive",
      });
      return;
    }

    // Only include customerId if a customer is selected (Zod expects optional, not null)
    if (selectedCustomer?.id) {
      orderData.customerId = selectedCustomer.id;
    }
    if (redeemPoints > 0) {
      orderData.redeemPoints = redeemPoints;
    }
    orderData.sendEmailReceipt = emailReceipt && !!selectedCustomer?.email;

    placeOrderMutation.mutate(orderData);
  };

  const cartPanelProps: PosCartPanelProps = {
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
    appliedPromo: appliedPromo as { name?: string } | null,
    setAppliedPromo,
    validatePromoMutation,
    customerTier: customerTier as PosCartPanelProps["customerTier"],
    loyaltyDiscount,
    subtotal,
    loyaltyDiscountAmount,
    promoDiscountAmount,
    tax,
    taxRatePercent,
    total,
    pointsEarned,
    tierProgress,
    minRedeemPoints: loyaltySettings?.minRedeemPoints ?? 100,
    redeemPoints,
    pointsRedemptionAmount,
    onRedeemPointsClick: () => setRedeemDialogOpen(true),
    handleCheckout,
    orderSubmitting: placeOrderMutation.isPending,
  };

  const submitting = placeOrderMutation.isPending;

  return (
    <div
      ref={narrowRef}
      className={cn(
        "pos-shell @container flex flex-col overflow-hidden @[640px]:flex-row",
        embedded ? "h-full" : "pos-viewport",
      )}
    >
      {view === "pay" ? (
        <div className="min-h-0 flex-1">
          <PosCheckoutStep
            total={total}
            itemCount={cartItemCount}
            customerName={selectedCustomer?.name ?? null}
            customerEmail={selectedCustomer?.email ?? null}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            personalUseReason={personalUseReason}
            setPersonalUseReason={setPersonalUseReason}
            splitPayment={splitPayment}
            setSplitPayment={setSplitPayment}
            tenderLegs={tenderLegs}
            setTenderLegs={setTenderLegs}
            splitRemaining={splitRemaining}
            orderDate={orderDate}
            setOrderDate={setOrderDate}
            fulfilmentMethod={fulfilmentMethod}
            setFulfilmentMethod={setFulfilmentMethod}
            giftCardPayment={giftCardPayment}
            setGiftCardPayment={setGiftCardPayment}
            channel={channel}
            setChannel={setChannel}
            dueMinutes={dueMinutes}
            dueTime={dueTime}
            onSelectDueMinutes={selectDueMinutes}
            onSelectDueTime={selectDueTime}
            onClearDue={clearDue}
            duePreorderRequired={isPreorderDate}
            assigneeUserId={assigneeUserId}
            setAssigneeUserId={setAssigneeUserId}
            staff={staff}
            currentUserId={(authUser as { id?: string } | null)?.id ?? null}
            expenses={orderExpenses}
            expenseCategory={expenseCategory}
            setExpenseCategory={setExpenseCategory}
            expenseDescription={expenseDescription}
            setExpenseDescription={setExpenseDescription}
            expenseAmount={expenseAmount}
            setExpenseAmount={setExpenseAmount}
            onAddExpense={addExpense}
            onRemoveExpense={removeExpense}
            emailReceipt={emailReceipt}
            setEmailReceipt={setEmailReceipt}
            submitting={submitting}
            onBack={() => setView("build")}
            onConfirm={processPayment}
          />
        </div>
      ) : (
        <>
          {/* Step 1: the order itself. */}
          <div className="pos-products-panel flex min-h-0 flex-1 flex-col @[640px]:max-w-[62%] @[640px]:flex-[1.62]">
            {embedded ? (
              (sellingLocation || noLocationWillResolve) && (
                <div className="shrink-0 px-4 pb-2 pt-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-metal-muted">Step 1 of 2 · Build the order</p>
                  {sellingLocation ? (
                    <p className="mt-1 text-xs text-metal-muted" data-testid="pos-selling-location">
                      Selling at <span className="font-medium text-foreground">{sellingLocation.name}</span>
                    </p>
                  ) : (
                    <p className="mt-1 text-xs font-medium text-destructive" data-testid="pos-no-location-warning">
                      No selling location is set up. Ask an admin to set an organization default
                      location, or a default location for this user, before taking payment.
                    </p>
                  )}
                </div>
              )
            ) : (
              <div className="pos-section-header shrink-0 px-4 pb-3 pt-3 sm:px-6 sm:pt-5">
                <PageHeader
                  className="mb-0 sm:flex-col sm:items-stretch sm:justify-start 2xl:flex-row 2xl:items-start 2xl:justify-between"
                  eyebrow="Step 1 of 2 · Build the order"
                  title="Create Order"
                  question={narrow ? undefined : "What is this customer buying?"}
                  explanation={narrow ? undefined : "Type a code or name, scan, or tap a top seller. Fix quantity and price on the line."}
                />
                {sellingLocation ? (
                  <p className="mt-2 text-xs text-metal-muted" data-testid="pos-selling-location">
                    Selling at <span className="font-medium text-foreground">{sellingLocation.name}</span>
                  </p>
                ) : noLocationWillResolve ? (
                  <p
                    className="mt-2 text-xs font-medium text-destructive"
                    data-testid="pos-no-location-warning"
                  >
                    No selling location is set up. Ask an admin to set an organization default
                    location, or a default location for this user, before taking payment.
                  </p>
                ) : null}
              </div>
            )}

            {/* Plain overflow scrolling, not a scroll-area widget: touch
                scrolling and the on-screen keyboard both behave with the
                browser's own scroller. */}
            {/* Extra bottom room on phones so the last card can scroll clear of
                the app's floating assistant buttons. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-3 sm:px-6 sm:pb-6">
              {productsLoading ? (
                <p className="py-6 text-sm text-metal-muted" data-testid="pos-products-loading">
                  Loading the catalogue…
                </p>
              ) : (
                <PosOrderLines
                  products={products}
                  lines={cart}
                  onChange={setCart}
                  disabled={submitting}
                  aboveLines={<PosTopSellers products={products} onAdd={addToCart} disabled={submitting} />}
                />
              )}

              {/* On a narrow form — a phone, or the Operations Centre's pane —
                  the customer, discounts and totals sit under the lines
                  rather than beside them. */}
              {narrow && (
                <div className="lm-card mt-6 rounded-xl border border-metal-edge p-4" data-testid="pos-mobile-summary">
                  <PosCartPanel {...cartPanelProps} showCheckoutButton={false} />
                </div>
              )}
            </div>

            {narrow && (
              <div
                // Right padding keeps the button clear of the app's floating
                // chat launcher, which sits fixed in the bottom-right corner.
                className="pos-action-bar shrink-0 py-3 pl-4 pr-[4.75rem]"
                style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs text-metal-muted">
                      {cartItemCount} {cartItemCount === 1 ? "item" : "items"}
                      {selectedCustomer ? ` · ${selectedCustomer.name}` : ""}
                    </div>
                    <div className="text-2xl font-bold tabular-nums text-metal-warm-white" data-testid="mobile-order-total">
                      £{total.toFixed(2)}
                    </div>
                  </div>
                  <Button
                    onClick={handleCheckout}
                    size="lg"
                    className="lm-btn-metal min-h-[52px] shrink-0 gap-2 px-5 text-base font-semibold"
                    disabled={cart.length === 0 || submitting}
                    data-testid="mobile-checkout-button"
                  >
                    {submitting ? (
                      <>
                        <ActionLoader className="text-primary-foreground" />
                        Wait…
                      </>
                    ) : (
                      "Take payment"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* A wide enough form: customer, discounts and totals in a rail
              beside the lines rather than under them. */}
          {!narrow && (
            <div className="pos-cart-rail flex w-full flex-col overflow-y-auto border-l border-metal-edge p-4 max-w-[38%] flex-1">
              <PosCartPanel {...cartPanelProps} />
            </div>
          )}
        </>
      )}

      <Dialog open={redeemDialogOpen} onOpenChange={setRedeemDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redeem loyalty points</DialogTitle>
            <DialogDescription>
              {selectedCustomer?.name} has {selectedCustomer?.loyaltyPoints ?? 0} points.
              Minimum redemption: {loyaltySettings?.minRedeemPoints ?? 100} points.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="redeem-points-input">Points to redeem</Label>
            <Input
              id="redeem-points-input"
              type="number"
              min={loyaltySettings?.minRedeemPoints ?? 100}
              max={selectedCustomer?.loyaltyPoints ?? 0}
              value={redeemInput}
              onChange={(e) => setRedeemInput(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRedeemDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                const pts = parseInt(redeemInput, 10);
                if (!selectedCustomer?.id || !pts) return;
                try {
                  const res = await apiFetch("/api/loyalty/redeem-preview", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ customerId: selectedCustomer.id, points: pts }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.message || "Redemption failed");
                  setRedeemPoints(pts);
                  setPointsRedemptionAmount(data.discountAmount);
                  setRedeemDialogOpen(false);
                  toast({ title: "Points applied", description: `£${data.discountAmount.toFixed(2)} discount` });
                } catch (e: any) {
                  toast({ title: "Cannot redeem", description: e.message, variant: "destructive" });
                }
              }}
            >
              Apply discount
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
