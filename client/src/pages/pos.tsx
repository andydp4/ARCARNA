import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { apiFetch } from "@/lib/appPaths";
import { offlineStorage } from "@/lib/offline-storage";
import { invalidateAfterPosCheckout } from "@/lib/query-invalidation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ShoppingCart, Package, Search, Trash2, Plus, CreditCard, DollarSign, Smartphone, Receipt } from "lucide-react";
import { Link } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { PosProductCard } from "@/components/pos-product-card";
import type { PosProduct } from "@/components/pos-product-card";
import { PosCartPanel, type PosCartPanelProps } from "@/components/pos-cart-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionLoader } from "@/components/action-loader";

type Product = PosProduct;

interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  category: string;
  loyaltyPoints: number;
}

interface CartItem {
  product: Product;
  quantity: number;
  customPrice: number;
  subtotal: number;
  // Local editing states (not in sync with actual values)
  priceInput?: string;
  quantityInput?: string;
}

/** Fixed-height placeholders matching product card grid to avoid layout jump while products load */
function PosProductGridSkeleton() {
  const placeholders = 8;
  return (
    <>
      {Array.from({ length: placeholders }).map((_, i) => (
        <div
          key={i}
          className="flex min-h-[188px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm"
        >
          <div className="space-y-2 px-3 pb-2 pt-3 sm:px-4 sm:pt-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="flex flex-1 flex-col px-3 pb-3 sm:px-4 sm:pb-4">
            <Skeleton className="mb-2 h-8 w-24" />
            <Skeleton className="mb-2 h-5 w-28" />
            <Skeleton className="mt-auto h-11 w-full rounded-md" />
          </div>
        </div>
      ))}
    </>
  );
}

export default function POS() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [cartOpen, setCartOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [customerSearch, setCustomerSearch] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<any>(null);
  const [loyaltyDiscount, setLoyaltyDiscount] = useState(0);
  const [customerTier, setCustomerTier] = useState<any>(null);
  const [orderExpenses, setOrderExpenses] = useState<Array<{
    category: string;
    description: string;
    amount: number;
  }>>([]);
  const [expenseCategory, setExpenseCategory] = useState("shipping");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");

  // Fetch products
  const { data: products = [], isLoading: productsLoading } = useQuery<PosProduct[]>({
    queryKey: ["/api/products"],
  });

  // Fetch customers
  const { data: customers = [], isLoading: customersLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  // Fetch loyalty tiers
  const { data: loyaltyTiers = [] } = useQuery<any[]>({
    queryKey: ["/api/loyalty-tiers"],
  });

  // Stable list reference when cart/checkout state changes → memoized product tiles can skip re-render
  const filteredProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          product.productId.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (product.barcode && product.barcode.includes(searchTerm))
      ),
    [products, searchTerm]
  );

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
            data: orderData
          });
          console.log('[POS] Order mutation queued successfully');
        } catch (queueError) {
          console.error('[POS] Failed to queue mutation:', queueError);
          throw queueError;
        }
        
        try {
          if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.ready;
            if ('sync' in registration) {
              await (registration as any).sync.register('sync-orders');
            }
          }
        } catch (swError) {
          console.log('[PWA] Background sync not supported, will sync on next online event');
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
        });
      }
      setCart([]);
      setSelectedCustomer(null);
      setCheckoutDialogOpen(false);
      setOrderExpenses([]);
      setExpenseDescription("");
      setExpenseAmount("");
      await invalidateAfterPosCheckout(queryClient);
    },
    onError: (error: any) => {
      toast({
        title: "Order Failed",
        description: error.message || "Failed to process the order",
        variant: "destructive",
      });
    },
  });

  const addToCart = useCallback((product: Product) => {
    if (placeOrderMutation.isPending) return;
    const price =
      typeof product.defaultSalePrice === "string"
        ? parseFloat(product.defaultSalePrice)
        : product.defaultSalePrice;

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
    toast({
      title: "Added to Cart",
      description: `${product.name} added to cart`,
    });
  }, [placeOrderMutation.isPending, toast]);

  // Update cart quantity
  const updateQuantity = (productId: string, delta: number) => {
    if (placeOrderMutation.isPending) return;
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id === productId) {
            const newQuantity = Math.max(0, item.quantity + delta);
            return {
              ...item,
              quantity: newQuantity,
              subtotal: newQuantity * item.customPrice,
            };
          }
          return item;
        })
        .filter((item) => item.quantity > 0)
    );
  };
  
  // Remove from cart
  const removeFromCart = (productId: string) => {
    if (placeOrderMutation.isPending) return;
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

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

  // Calculate totals with discounts
  const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  const loyaltyDiscountAmount = (subtotal * loyaltyDiscount) / 100;
  const promoDiscountAmount = appliedPromo ? 
    (appliedPromo.type === 'percentage' ? (subtotal * parseFloat(appliedPromo.value)) / 100 : parseFloat(appliedPromo.value))
    : 0;
  const totalDiscount = loyaltyDiscountAmount + promoDiscountAmount;
  const discountedSubtotal = Math.max(0, subtotal - totalDiscount);
  const tax = discountedSubtotal * 0.1; // 10% tax
  const total = discountedSubtotal + tax;
  
  // Calculate loyalty points earned (1 point per dollar spent, with tier multiplier)
  const pointsEarned = Math.floor(total * (customerTier?.pointsMultiplier || 1));

  // Total item count for cart badge (sum of quantities)
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Handle checkout
  const handleCheckout = useCallback(() => {
    if (placeOrderMutation.isPending) return;
    if (cart.length === 0) {
      toast({
        title: "Cart Empty",
        description: "Please add items to cart before checkout",
        variant: "destructive",
      });
      return;
    }
    setCheckoutDialogOpen(true);
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
      description: `Added ${expenseCategory} expense: $${(isNaN(amount) ? 0 : amount).toFixed(2)}`,
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
        title: "Cart Empty",
        description: "Add items to cart before processing payment",
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

    const orderData: any = {
      lines: cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        unitPrice: item.customPrice,
      })),
      paymentMethod: paymentMethod,
    };
    
    // Only include customerId if a customer is selected (Zod expects optional, not null)
    if (selectedCustomer?.id) {
      orderData.customerId = selectedCustomer.id;
    }

    placeOrderMutation.mutate(orderData);
  };

  const formatPrice = (p: Product) =>
    `$${(typeof p.defaultSalePrice === "string" ? parseFloat(p.defaultSalePrice) || 0 : p.defaultSalePrice || 0).toFixed(2)}`;

  const safeAreaBottom = "env(safe-area-inset-bottom, 0px)";
  const mobileGridPaddingBottom = isMobile
    ? `calc(${safeAreaBottom} + ${cart.length > 0 ? "8.25rem" : "5rem"})`
    : undefined;
  const mobileFabBottom = cart.length > 0
    ? `calc(${safeAreaBottom} + 6rem)`
    : `max(1rem, ${safeAreaBottom})`;
  const mobileQuickBarBottom = `max(1rem, ${safeAreaBottom})`;

  const cartPanelProps = {
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
    appliedPromo: appliedPromo as { name?: string } | null,
    setAppliedPromo,
    validatePromoMutation,
    customerTier: customerTier as PosCartPanelProps["customerTier"],
    loyaltyDiscount,
    subtotal,
    loyaltyDiscountAmount,
    promoDiscountAmount,
    tax,
    total,
    pointsEarned,
    removeFromCart,
    updateQuantity,
    formatPrice,
    handleCheckout,
    orderSubmitting: placeOrderMutation.isPending,
  };

  return (
    <div
      className="flex h-screen flex-col bg-background lg:flex-row"
      style={{ paddingBottom: isMobile ? safeAreaBottom : undefined }}
    >
      {/* Products Panel - Step 1: Add items */}
      <div className="flex-1 overflow-hidden p-4 sm:p-6">
        <div className="mb-6 border-b border-border/60 pb-6">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Step 1 of 4 · Add items</p>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Point of sale</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">Search products, build the cart, then check out.</p>
            </div>
            {!isMobile && (
              <Button asChild variant="outline" className="min-h-[44px] shrink-0" data-testid="link-dashboard">
                <Link href="/">
                  <Package className="mr-2 h-4 w-4" />
                  Dashboard
                </Link>
              </Button>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, SKU, or barcode…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="min-h-[44px] pl-10"
              data-testid="search-products"
            />
          </div>
        </div>

        <ScrollArea className="h-[calc(100vh-180px)] lg:h-[calc(100vh-140px)]">
          <div
            className="grid grid-cols-2 gap-3 p-1 sm:grid-cols-2 sm:gap-4 md:grid-cols-3 lg:grid-cols-2 lg:pb-4 xl:grid-cols-3 2xl:grid-cols-4"
            style={mobileGridPaddingBottom ? { paddingBottom: mobileGridPaddingBottom } : undefined}
          >
            {productsLoading ? (
              <PosProductGridSkeleton />
            ) : filteredProducts.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-border/80 bg-muted/20 px-6 py-12 text-center">
                <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/70" />
                <p className="font-medium text-foreground">No products match this search</p>
                <p className="mt-2 text-sm text-muted-foreground">Try another keyword or clear the search box.</p>
              </div>
            ) : (
              filteredProducts.map((product) => (
                <PosProductCard
                  key={product.id}
                  product={product}
                  onAdd={addToCart}
                  disabled={placeOrderMutation.isPending}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Desktop Cart Panel */}
      {!isMobile && (
        <div className="flex w-96 flex-col border-l border-border/60 bg-card p-4 shadow-sm">
          <PosCartPanel {...cartPanelProps} />
        </div>
      )}

      {/* Mobile Cart Sheet + FAB */}
      {isMobile && (
        <>
          <Sheet open={cartOpen} onOpenChange={setCartOpen}>
            <SheetTrigger asChild>
              <Button
                size="lg"
                className="fixed right-4 z-50 h-14 w-14 min-h-[48px] min-w-[48px] rounded-full p-0 shadow-lg"
                style={{ bottom: mobileFabBottom }}
                data-testid="mobile-cart-button"
                aria-label={cartItemCount > 0 ? `Cart: ${cartItemCount} items` : "Open cart"}
              >
                <div className="relative">
                  <ShoppingCart className="h-6 w-6" />
                  {cartItemCount > 0 && (
                    <Badge className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center p-0 text-xs">
                      {cartItemCount}
                    </Badge>
                  )}
                </div>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:w-96 flex flex-col p-4">
              <SheetHeader className="mb-4">
                <SheetTitle>
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="h-5 w-5 shrink-0" />
                    Cart
                    {cartItemCount > 0 && (
                      <Badge variant="secondary" className="font-normal">
                        {cartItemCount} items
                      </Badge>
                    )}
                  </div>
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-1 flex-col overflow-hidden">
                <PosCartPanel {...cartPanelProps} />
              </div>
            </SheetContent>
          </Sheet>

          {/* Mobile quick bar - visible when cart has items, above FAB */}
          {cart.length > 0 && (
            <div className="fixed bottom-0 left-4 right-16 z-40 lg:hidden" style={{ bottom: mobileQuickBarBottom }}>
              <Card className="border-border/60 shadow-lg">
                <CardContent className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">{cartItemCount} items</div>
                    <div className="text-lg font-bold">${total.toFixed(2)}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      onClick={() => setCartOpen(true)}
                      size="sm"
                      className="min-h-[44px]"
                      disabled={placeOrderMutation.isPending}
                      data-testid="view-cart-button"
                    >
                      Review
                    </Button>
                    <Button
                      onClick={handleCheckout}
                      size="sm"
                      className="min-h-[44px] gap-2"
                      disabled={placeOrderMutation.isPending}
                      data-testid="mobile-checkout-button"
                    >
                      {placeOrderMutation.isPending ? (
                        <>
                          <ActionLoader className="text-primary-foreground" />
                          Wait…
                        </>
                      ) : (
                        "Checkout"
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {/* Checkout Dialog - Steps 3 & 4: Choose payment → Confirm */}
      <Dialog open={checkoutDialogOpen} onOpenChange={setCheckoutDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader className="space-y-1 text-left">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Step 3 &amp; 4 of 4</p>
            <DialogTitle className="text-xl font-semibold tracking-tight">Payment &amp; confirm</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              Choose how the customer paid, then confirm to complete the sale.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Payment Method</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger data-testid="select-payment" className="min-h-[44px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4" />
                      Cash
                    </div>
                  </SelectItem>
                  <SelectItem value="card">
                    <div className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4" />
                      Card
                    </div>
                  </SelectItem>
                  <SelectItem value="transfer">
                    <div className="flex items-center gap-2">
                      <Smartphone className="h-4 w-4" />
                      Transfer
                    </div>
                  </SelectItem>
                  <SelectItem value="tick">
                    <div className="flex items-center gap-2">
                      <Receipt className="h-4 w-4" />
                      On Credit (Tick)
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Order Expenses Section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Order Expenses (Optional)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <Select value={expenseCategory} onValueChange={setExpenseCategory}>
                    <SelectTrigger className="w-full sm:w-[130px] min-h-[44px]" data-testid="select-expense-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shipping">Shipping</SelectItem>
                      <SelectItem value="travel">Travel</SelectItem>
                      <SelectItem value="packaging">Packaging</SelectItem>
                      <SelectItem value="handling">Handling</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Description"
                    value={expenseDescription}
                    onChange={(e) => setExpenseDescription(e.target.value)}
                    className="flex-1 min-h-[44px]"
                    data-testid="input-expense-desc"
                  />
                  <div className="flex gap-2">
                    <Input
                      placeholder="0.00"
                      type="number"
                      value={expenseAmount}
                      onChange={(e) => setExpenseAmount(e.target.value)}
                      className="w-full sm:w-[100px] min-h-[44px]"
                      data-testid="input-expense-amt"
                    />
                    <Button
                      size="sm"
                      onClick={addExpense}
                      variant="outline"
                      className="min-h-[44px] min-w-[44px]"
                      data-testid="button-add-order-expense"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                
                {orderExpenses.length > 0 && (
                  <div className="space-y-1">
                    {orderExpenses.map((expense, index) => (
                      <div key={index} className="flex items-center justify-between text-sm py-2 gap-2">
                        <span className="text-muted-foreground flex-1 break-words">
                          {expense.category}: {expense.description}
                        </span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="font-medium">${expense.amount.toFixed(2)}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeExpense(index)}
                            className="h-8 w-8 p-0 min-h-[32px] min-w-[32px]"
                            data-testid={`button-remove-expense-${index}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    <Separator />
                    <div className="flex justify-between font-medium pt-1">
                      <span>Total Expenses</span>
                      <span>${orderExpenses.reduce((sum, exp) => sum + exp.amount, 0).toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Customer</span>
                    <span className="font-medium">{selectedCustomer?.name || "Walk-in"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Items</span>
                    <span className="font-medium">{cart.reduce((sum, item) => sum + item.quantity, 0)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total</span>
                    <span>${total.toFixed(2)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setCheckoutDialogOpen(false)} className="w-full sm:w-auto min-h-[44px]">
              Cancel
            </Button>
            <Button
              onClick={processPayment}
              disabled={cart.length === 0 || placeOrderMutation.isPending}
              aria-label={cart.length === 0 ? "Payment disabled – add items to cart" : "Confirm payment"}
              data-testid="button-confirm-payment"
              className="min-h-[44px] w-full gap-2 sm:w-auto"
            >
              {placeOrderMutation.isPending ? (
                <>
                  <ActionLoader className="text-primary-foreground" />
                  Processing…
                </>
              ) : (
                "Confirm payment"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}