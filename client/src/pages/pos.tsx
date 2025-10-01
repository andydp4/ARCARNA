import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ShoppingCart, Package, Search, Trash2, Plus, Minus, CreditCard, DollarSign, Smartphone, Receipt, Tag, Award, Star } from "lucide-react";
import { Link } from "wouter";

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
}

export default function POS() {
  const { toast } = useToast();
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
  const { data: loyaltyTiers = [] } = useQuery({
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
      const response = await apiRequest("POST", "/api/orders", orderData);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Order Placed",
        description: "Order has been successfully processed.",
      });
      setCart([]);
      setSelectedCustomer(null);
      setCheckoutDialogOpen(false);
      setOrderExpenses([]); // Clear expenses after successful order
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
      description: `Added ${expenseCategory} expense: $${amount.toFixed(2)}`,
    });
  };

  // Remove expense from order
  const removeExpense = (index: number) => {
    setOrderExpenses(orderExpenses.filter((_, i) => i !== index));
  };

  // Process payment
  const processPayment = () => {
    const orderData = {
      customer_id: selectedCustomer?.id || null,
      items: cart.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price: item.customPrice,
        total_price: item.subtotal,
      })),
      subtotal,
      tax,
      total,
      payment_method: paymentMethod,
      expenses: orderExpenses // Include expenses in order data
    };

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

  return (
    <div className="flex h-screen bg-background">
      {/* Products Panel */}
      <div className="flex-1 p-4 overflow-hidden">
        <div className="mb-4">
          <h1 className="text-2xl font-bold mb-4">POS Terminal</h1>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, SKU, or barcode..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="search-products"
              />
            </div>
            <Button asChild variant="outline" data-testid="link-dashboard">
              <Link href="/">
                <Package className="mr-2 h-4 w-4" />
                Dashboard
              </Link>
            </Button>
          </div>
        </div>

        <ScrollArea className="h-[calc(100vh-140px)]">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
                          ? parseFloat(product.defaultSalePrice).toFixed(2) 
                          : product.defaultSalePrice.toFixed(2)}
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

      {/* Cart Panel */}
      <div className="w-96 border-l bg-card p-4 flex flex-col">
        <div className="mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Shopping Cart
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
            <SelectTrigger data-testid="select-customer">
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
                            ? parseFloat(item.product.defaultSalePrice).toFixed(2) 
                            : item.product.defaultSalePrice.toFixed(2)}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removeFromCart(item.product.id)}
                        data-testid={`remove-item-${item.product.id}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    
                    {/* Price editing field */}
                    <div className="flex items-center gap-2 mb-2">
                      <Label className="text-sm">Price:</Label>
                      <div className="flex items-center gap-1">
                        <span className="text-sm">$</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.customPrice.toFixed(2)}
                          onChange={(e) => {
                            const newPrice = parseFloat(e.target.value);
                            if (!isNaN(newPrice) && newPrice >= 0) {
                              updateCustomPrice(item.product.id, newPrice);
                            }
                          }}
                          className="h-8 w-24"
                          data-testid={`price-input-${item.product.id}`}
                        />
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => updateQuantity(item.product.id, -1)}
                          data-testid={`decrease-qty-${item.product.id}`}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-12 text-center" data-testid={`qty-${item.product.id}`}>
                          {item.quantity}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => updateQuantity(item.product.id, 1)}
                          data-testid={`increase-qty-${item.product.id}`}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <span className="font-semibold">${item.subtotal.toFixed(2)}</span>
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
                <div className="flex justify-between text-sm text-muted-foreground pt-2">
                  <span>Points Earned</span>
                  <span data-testid="points-earned">+{pointsEarned} pts</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Checkout Button */}
        <Button
          size="lg"
          className="w-full"
          onClick={handleCheckout}
          disabled={cart.length === 0 || placeOrderMutation.isPending}
          data-testid="button-checkout"
        >
          {placeOrderMutation.isPending ? "Processing..." : "Checkout"}
        </Button>
      </div>

      {/* Checkout Dialog */}
      <Dialog open={checkoutDialogOpen} onOpenChange={setCheckoutDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Payment</DialogTitle>
            <DialogDescription>Choose payment method to complete the order</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Payment Method</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger data-testid="select-payment">
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
                <div className="flex gap-2">
                  <Select value={expenseCategory} onValueChange={setExpenseCategory}>
                    <SelectTrigger className="w-[130px]" data-testid="select-expense-category">
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
                    className="flex-1"
                    data-testid="input-expense-desc"
                  />
                  <Input
                    placeholder="0.00"
                    type="number"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                    className="w-[100px]"
                    data-testid="input-expense-amt"
                  />
                  <Button
                    size="sm"
                    onClick={addExpense}
                    variant="outline"
                    data-testid="button-add-order-expense"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                
                {orderExpenses.length > 0 && (
                  <div className="space-y-1">
                    {orderExpenses.map((expense, index) => (
                      <div key={index} className="flex items-center justify-between text-sm py-1">
                        <span className="text-muted-foreground">
                          {expense.category}: {expense.description}
                        </span>
                        <div className="flex items-center gap-2">
                          <span>${expense.amount.toFixed(2)}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeExpense(index)}
                            className="h-6 w-6 p-0"
                            data-testid={`button-remove-expense-${index}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    <Separator />
                    <div className="flex justify-between font-medium">
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

          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckoutDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={processPayment} disabled={placeOrderMutation.isPending} data-testid="button-confirm-payment">
              {placeOrderMutation.isPending ? "Processing..." : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}