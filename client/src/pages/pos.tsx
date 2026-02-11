import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { offlineStorage } from "@/lib/offline-storage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ShoppingCart, Package, Search, Trash2, Plus, Minus, CreditCard, DollarSign, Smartphone, Receipt, Tag, Award, Star, X } from "lucide-react";
import { Link } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";

interface Product {
  id: string;
  name: string;
  productId: string;
  defaultSalePrice: string | number;
  stock: number;
  stockLimit: number;
  barcode?: string | null;
}

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
  const { data: products = [], isLoading: productsLoading } = useQuery<Product[]>({
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

  // Filter products based on search
  const filteredProducts = products.filter(
    (product) =>
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.productId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (product.barcode && product.barcode.includes(searchTerm))
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
        
        const response = await fetch('/api/orders', {
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
    onSuccess: (data: any) => {
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
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics"] });
    },
    onError: (error: any) => {
      toast({
        title: "Order Failed",
        description: error.message || "Failed to process the order",
        variant: "destructive",
      });
    },
  });

  // Add to cart
  const addToCart = (product: Product) => {
    const price = typeof product.defaultSalePrice === 'string' 
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
  };

  // Update cart quantity
  const updateQuantity = (productId: string, delta: number) => {
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
  
  // Update custom price for cart item
  const updateCustomPrice = (productId: string, newPrice: number) => {
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId
          ? {
              ...item,
              customPrice: newPrice,
              subtotal: item.quantity * newPrice,
            }
          : item
      )
    );
  };

  // Remove from cart
  const removeFromCart = (productId: string) => {
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
  const handleCheckout = () => {
    if (cart.length === 0) {
      toast({
        title: "Cart Empty",
        description: "Please add items to cart before checkout",
        variant: "destructive",
      });
      return;
    }
    setCheckoutDialogOpen(true);
  };

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

  // Get stock status badge
  const getStockBadge = (product: Product) => {
    const stockPercentage = (product.stock / product.stockLimit) * 100;
    if (product.stock === 0) {
      return <Badge variant="destructive">Out of Stock</Badge>;
    } else if (stockPercentage <= 20) {
      return <Badge variant="destructive">Low Stock ({product.stock})</Badge>;
    } else if (stockPercentage <= 50) {
      return <Badge variant="secondary">Stock: {product.stock}</Badge>;
    }
    return <Badge variant="outline">Stock: {product.stock}</Badge>;
  };

  // Cart panel content component (used in both desktop and mobile views)
  const CartPanel = () => (
    <>
      <div className="mb-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" />
          Shopping Cart{cartItemCount > 0 ? ` (${cartItemCount})` : ""}
        </h2>
      </div>

      {/* Customer Selection */}
      <div className="mb-4">
        <Select
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
        
        {/* Customer Loyalty Info */}
        {selectedCustomer && customerTier && (
          <Card className="mt-2">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm font-medium">{customerTier.name} Member</span>
                </div>
                <Badge variant="outline">
                  <Star className="h-3 w-3 mr-1" />
                  {selectedCustomer.loyaltyPoints} pts
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {customerTier.discountPercentage}% discount • {customerTier.pointsMultiplier}x points
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      
      {/* Promo Code Field */}
      {selectedCustomer && (
        <div className="mb-4">
          <div className="flex gap-2">
            <Input
              placeholder="Enter promo code..."
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              data-testid="input-promo-code"
              className="min-h-[44px]"
            />
            <Button
              variant="outline"
              onClick={() => {
                if (promoCode) {
                  validatePromoMutation.mutate(promoCode);
                }
              }}
              disabled={!promoCode || validatePromoMutation.isPending}
              data-testid="button-apply-promo"
              className="min-h-[44px] min-w-[44px]"
            >
              <Tag className="h-4 w-4" />
            </Button>
          </div>
          {appliedPromo && (
            <div className="mt-2 flex items-center justify-between p-2 bg-secondary rounded">
              <span className="text-sm">{appliedPromo.name}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAppliedPromo(null);
                  setPromoCode("");
                }}
                data-testid="button-remove-promo"
                className="min-h-[44px] min-w-[44px]"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      <Separator className="mb-4" />

      {/* Cart Items */}
      <ScrollArea className="flex-1 mb-4">
        {cart.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">Cart is empty</div>
        ) : (
          <div className="space-y-3">
            {cart.map((item) => (
              <Card key={item.product.id} data-testid={`cart-item-${item.product.id}`}>
                <CardContent className="p-3">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="font-medium line-clamp-1">{item.product.name}</div>
                      <div className="text-sm text-muted-foreground">
                        Default: ${typeof item.product.defaultSalePrice === 'string' 
                          ? (isNaN(parseFloat(item.product.defaultSalePrice)) ? 0 : parseFloat(item.product.defaultSalePrice)).toFixed(2) 
                          : (item.product.defaultSalePrice || 0).toFixed(2)}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 min-h-[36px] min-w-[36px]"
                      onClick={() => removeFromCart(item.product.id)}
                      data-testid={`remove-item-${item.product.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  {/* Price editing field */}
                  <div className="flex items-center gap-2 mb-2">
                    <Label className="text-sm">Price:</Label>
                    <div className="flex items-center gap-1">
                      <span className="text-sm">$</span>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={item.priceInput ?? item.customPrice.toFixed(2)}
                        onChange={(e) => {
                          // Update local state only, no validation yet
                          setCart((prev) =>
                            prev.map((cartItem) =>
                              cartItem.product.id === item.product.id
                                ? { ...cartItem, priceInput: e.target.value }
                                : cartItem
                            )
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        onBlur={(e) => {
                          console.log('[POS] Price blur event triggered, value:', e.target.value);
                          // Validate and apply on blur
                          const newPrice = parseFloat(e.target.value);
                          console.log('[POS] Parsed price:', newPrice, 'for product:', item.product.id);
                          if (!isNaN(newPrice) && newPrice >= 0) {
                            console.log('[POS] Updating price to:', newPrice, 'quantity:', item.quantity);
                            // Update price, subtotal, and clear local state in one operation
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
                            console.log('[POS] Invalid price, resetting');
                            // Reset to actual value if invalid
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
                        className="h-9 w-24 min-h-[36px]"
                        data-testid={`price-input-${item.product.id}`}
                      />
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 min-h-[44px] min-w-[44px]"
                        onClick={() => updateQuantity(item.product.id, -1)}
                        data-testid={`decrease-qty-${item.product.id}`}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={item.quantityInput ?? item.quantity.toString()}
                        onChange={(e) => {
                          // Update local state only
                          setCart((prev) =>
                            prev.map((cartItem) =>
                              cartItem.product.id === item.product.id
                                ? { ...cartItem, quantityInput: e.target.value }
                                : cartItem
                            )
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        onBlur={(e) => {
                          console.log('[POS] Quantity blur event triggered, value:', e.target.value);
                          // Validate and apply on blur
                          const newQty = parseInt(e.target.value);
                          console.log('[POS] Parsed quantity:', newQty, 'for product:', item.product.id);
                          if (!isNaN(newQty) && newQty > 0) {
                            console.log('[POS] Updating quantity to:', newQty, 'price:', item.customPrice);
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
                          } else if (newQty === 0 || e.target.value === '0') {
                            console.log('[POS] Removing item (quantity 0)');
                            // Remove item if quantity is 0
                            removeFromCart(item.product.id);
                          } else {
                            console.log('[POS] Invalid quantity, resetting');
                            // Reset to actual value if invalid
                            setCart((prev) =>
                              prev.map((cartItem) =>
                                cartItem.product.id === item.product.id
                                  ? { ...cartItem, quantityInput: undefined }
                                  : cartItem
                              )
                            );
                            toast({
                              title: "Invalid Quantity",
                              description: "Please enter a valid quantity",
                              variant: "destructive",
                            });
                          }
                        }}
                        className="h-9 w-16 text-center font-medium min-h-[36px]"
                        data-testid={`qty-input-${item.product.id}`}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 min-h-[44px] min-w-[44px]"
                        onClick={() => updateQuantity(item.product.id, 1)}
                        data-testid={`increase-qty-${item.product.id}`}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <span className="font-semibold text-lg">${item.subtotal.toFixed(2)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Totals */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Subtotal</span>
              <span data-testid="cart-subtotal">${subtotal.toFixed(2)}</span>
            </div>
            {loyaltyDiscountAmount > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Loyalty Discount ({loyaltyDiscount}%)</span>
                <span data-testid="loyalty-discount">-${loyaltyDiscountAmount.toFixed(2)}</span>
              </div>
            )}
            {promoDiscountAmount > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Promo: {appliedPromo?.name}</span>
                <span data-testid="promo-discount">-${promoDiscountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span>Tax (10%)</span>
              <span data-testid="cart-tax">${tax.toFixed(2)}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span data-testid="cart-total">${total.toFixed(2)}</span>
            </div>
            {selectedCustomer && pointsEarned > 0 && (
              <div className="text-xs text-center text-muted-foreground pt-2 border-t">
                <Award className="h-3 w-3 inline mr-1" />
                Earn {pointsEarned} loyalty points with this purchase
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Checkout Button */}
      <Button
        onClick={handleCheckout}
        disabled={cart.length === 0}
        aria-label={cart.length === 0 ? "Checkout disabled – add items to cart" : "Proceed to checkout"}
        title={cart.length === 0 ? "Add items to cart" : undefined}
        className="w-full min-h-[48px]"
        size="lg"
        data-testid="button-checkout"
      >
        <Receipt className="mr-2 h-5 w-5" />
        Checkout
      </Button>
    </>
  );

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-background">
      {/* Products Panel */}
      <div className="flex-1 p-4 overflow-hidden">
        <div className="mb-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl sm:text-2xl font-bold">POS Terminal</h1>
            {!isMobile && (
              <Button asChild variant="outline" data-testid="link-dashboard">
                <Link href="/">
                  <Package className="mr-2 h-4 w-4" />
                  Dashboard
                </Link>
              </Button>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, SKU, or barcode..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 min-h-[44px]"
              data-testid="search-products"
            />
          </div>
        </div>

        <ScrollArea className="h-[calc(100vh-180px)] lg:h-[calc(100vh-140px)]">
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-4 pb-20 lg:pb-0">
            {productsLoading ? (
              <div className="col-span-full text-center py-8 text-muted-foreground">Loading products...</div>
            ) : filteredProducts.length === 0 ? (
              <div className="col-span-full text-center py-8 text-muted-foreground">No products found</div>
            ) : (
              filteredProducts.map((product) => (
                <Card
                  key={product.id}
                  className="cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => addToCart(product)}
                  data-testid={`product-card-${product.id}`}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg line-clamp-1">{product.name}</CardTitle>
                    <div className="text-sm text-muted-foreground">{product.productId}</div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-2xl font-bold">
                        ${typeof product.defaultSalePrice === 'string' 
                          ? (isNaN(parseFloat(product.defaultSalePrice)) ? 0 : parseFloat(product.defaultSalePrice)).toFixed(2) 
                          : (product.defaultSalePrice || 0).toFixed(2)}
                      </span>
                    </div>
                    {getStockBadge(product)}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Desktop Cart Panel */}
      {!isMobile && (
        <div className="w-96 border-l bg-card p-4 flex flex-col">
          <CartPanel />
        </div>
      )}

      {/* Mobile Cart Sheet */}
      {isMobile && (
        <>
          <Sheet open={cartOpen} onOpenChange={setCartOpen}>
            <SheetTrigger asChild>
              <Button
                size="lg"
                className="fixed bottom-4 right-4 z-50 rounded-full shadow-lg h-14 w-14 p-0"
                data-testid="mobile-cart-button"
                aria-label={cartItemCount > 0 ? `Cart with ${cartItemCount} items` : "Open cart"}
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
                    <ShoppingCart className="h-5 w-5" />
                    Shopping Cart{cartItemCount > 0 ? ` (${cartItemCount})` : ""}
                  </div>
                </SheetTitle>
              </SheetHeader>
              <div className="flex-1 flex flex-col overflow-hidden">
                <CartPanel />
              </div>
            </SheetContent>
          </Sheet>
          
          {/* Mobile Quick Actions Bar */}
          <div className="fixed bottom-20 left-4 right-4 z-40 lg:hidden">
            {cart.length > 0 && (
              <Card className="shadow-lg">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-muted-foreground">{cartItemCount} items</div>
                      <div className="text-lg font-bold">${total.toFixed(2)}</div>
                    </div>
                    <Button
                      onClick={() => setCartOpen(true)}
                      size="sm"
                      className="min-h-[44px]"
                      data-testid="view-cart-button"
                    >
                      View Cart
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}

      {/* Checkout Dialog - Mobile Responsive */}
      <Dialog open={checkoutDialogOpen} onOpenChange={setCheckoutDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Complete Payment</DialogTitle>
            <DialogDescription>Choose payment method to complete the order</DialogDescription>
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
              className="w-full sm:w-auto min-h-[44px]"
            >
              {placeOrderMutation.isPending ? "Processing..." : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}