import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { offlineStorage } from "@/lib/offline-storage";
import { invalidateAfterInventoryAdjustment } from "@/lib/query-invalidation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Package, Plus, Minus, Search, TrendingDown, AlertCircle, Home } from "lucide-react";
import { Link } from "wouter";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SmartStockTab } from "@/components/inventory/SmartStockTab";
import { Sparkles } from "lucide-react";

interface Product {
  id: string;
  name: string;
  productId: string;
  costPrice: string | number;
  defaultSalePrice: string | number;
  stock: number;
  stockLimit: number;
  barcode?: string | null;
  updatedAt?: string;
}

export default function Inventory() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [adjustmentValue, setAdjustmentValue] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<"add" | "set">("add");

  // Fetch products with real-time updates
  const { data: products = [], isLoading, refetch } = useQuery<Product[]>({
    queryKey: ["/api/inventory"],
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  // Filter products
  const filteredProducts = products.filter(
    (product) =>
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.productId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (product.barcode && product.barcode.includes(searchTerm))
  );

  // Get low stock products
  const lowStockProducts = products.filter((product) => {
    const stockPercentage = (product.stock / product.stockLimit) * 100;
    return stockPercentage <= 20 && product.stock > 0;
  });

  const outOfStockProducts = products.filter((product) => product.stock === 0);

  // Stock adjustment mutation
  const adjustStockMutation = useMutation({
    mutationFn: async (data: { productId: string; adjustment: number; type: "add" | "set" }) => {
      if (!navigator.onLine) {
        await offlineStorage.queueMutation({
          type: 'PRODUCT_UPDATE',
          method: 'PATCH',
          endpoint: `/api/inventory/${data.productId}`,
          data: { adjustment: data.adjustment, type: data.type }
        });
        return { offline: true };
      }
      
      const response = await apiRequest("PATCH", `/api/inventory/${data.productId}`, {
        adjustment: data.adjustment,
        type: data.type
      });
      return response.json();
    },
    onMutate: async (data) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["/api/inventory"] });

      // Snapshot previous value
      const previousProducts = queryClient.getQueryData(["/api/inventory"]);

      // Optimistically update
      queryClient.setQueryData(["/api/inventory"], (old: Product[] = []) =>
        old.map((p) =>
          p.id === data.productId
            ? {
                ...p,
                stock: data.type === "set" ? data.adjustment : p.stock + data.adjustment,
              }
            : p
        )
      );

      return { previousProducts };
    },
    onError: (error: any, _variables, context) => {
      // Rollback on error
      if (context?.previousProducts) {
        queryClient.setQueryData(["/api/inventory"], context.previousProducts);
      }
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update stock",
        variant: "destructive",
      });
    },
    onSuccess: async (data: any) => {
      if (data?.offline) {
        toast({
          title: "Update Queued",
          description: "Stock adjustment saved offline and will sync when connection returns.",
        });
      } else {
        toast({
          title: "Stock Updated",
          description: "Product stock has been successfully adjusted.",
        });
      }
      setAdjustmentDialogOpen(false);
      setSelectedProduct(null);
      setAdjustmentValue("");
      await invalidateAfterInventoryAdjustment(queryClient);
    },
  });

  // Get stock status and color
  const getStockStatus = (product: Product) => {
    const stockPercentage = (product.stock / product.stockLimit) * 100;
    if (product.stock === 0) {
      return { status: "Out of Stock", variant: "destructive" as const, color: "text-red-600" };
    } else if (stockPercentage <= 20) {
      return { status: "Low Stock", variant: "destructive" as const, color: "text-orange-600" };
    } else if (stockPercentage <= 50) {
      return { status: "Medium Stock", variant: "secondary" as const, color: "text-yellow-600" };
    }
    return { status: "In Stock", variant: "outline" as const, color: "text-green-600" };
  };

  // Handle stock adjustment
  const handleStockAdjustment = () => {
    if (!selectedProduct || !adjustmentValue) return;
    
    const value = parseInt(adjustmentValue);
    if (isNaN(value)) {
      toast({
        title: "Invalid Value",
        description: "Please enter a valid number",
        variant: "destructive",
      });
      return;
    }

    adjustStockMutation.mutate({
      productId: selectedProduct.id,
      adjustment: value,
      type: adjustmentType
    });
  };

  // Open adjustment dialog
  const openAdjustmentDialog = (product: Product, type: "add" | "set") => {
    setSelectedProduct(product);
    setAdjustmentType(type);
    setAdjustmentValue("");
    setAdjustmentDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary border-b border-slate-700 sticky top-0 z-50 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 bg-accent rounded-lg">
                <Package className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
              </div>
              <div>
                <h1 className="text-base sm:text-xl font-bold text-white">Inventory Management</h1>
                <p className="hidden sm:block text-xs text-slate-400">Real-time Stock Tracking</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" className="text-white min-h-[44px]" data-testid="link-home">
                <Link href="/">
                  <Home className="mr-0 sm:mr-2 h-4 w-4" />
                  <span className="hidden sm:inline">Dashboard</span>
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <Tabs defaultValue="stock" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2 mb-6 min-h-[48px]">
            <TabsTrigger value="stock" data-testid="tab-inventory-stock">Stock levels</TabsTrigger>
            <TabsTrigger value="smart" data-testid="tab-smart-stock" className="gap-1">
              <Sparkles className="h-4 w-4" />
              Smart Stock
            </TabsTrigger>
          </TabsList>
          <TabsContent value="smart">
            <SmartStockTab />
          </TabsContent>
          <TabsContent value="stock">
        {/* Alerts Section */}
        {(lowStockProducts.length > 0 || outOfStockProducts.length > 0) && (
          <div className="mb-4 sm:mb-6 space-y-3 sm:space-y-4">
            {outOfStockProducts.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle className="text-sm sm:text-base">Out of Stock Alert</AlertTitle>
                <AlertDescription className="text-xs sm:text-sm">
                  {outOfStockProducts.length} product{outOfStockProducts.length !== 1 ? 's are' : ' is'} out of stock:
                  {' '}{outOfStockProducts.slice(0, 3).map(p => p.name).join(', ')}
                  {outOfStockProducts.length > 3 && ` and ${outOfStockProducts.length - 3} more`}
                </AlertDescription>
              </Alert>
            )}
            {lowStockProducts.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-sm sm:text-base">Low Stock Warning</AlertTitle>
                <AlertDescription className="text-xs sm:text-sm">
                  {lowStockProducts.length} product{lowStockProducts.length !== 1 ? 's have' : ' has'} low stock:
                  {' '}{lowStockProducts.slice(0, 3).map(p => p.name).join(', ')}
                  {lowStockProducts.length > 3 && ` and ${lowStockProducts.length - 3} more`}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Products</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{products.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Stock Value</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                ${products.reduce((sum, p) => {
                  const price = typeof p.costPrice === 'string' ? parseFloat(p.costPrice) : p.costPrice || 0;
                  const stockValue = (isNaN(price) ? 0 : price) * (p.stock || 0);
                  return sum + (isNaN(stockValue) ? 0 : stockValue);
                }, 0).toFixed(2)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Low Stock Items</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-orange-600">{lowStockProducts.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Out of Stock</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-600">{outOfStockProducts.length}</p>
            </CardContent>
          </Card>
        </div>

        <Alert className="mb-4">
          <Package className="h-4 w-4" />
          <AlertTitle>Need a new product?</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            Stock lives here; create catalog entries in Product Management.
            <Link href="/products">
              <Button size="sm" variant="secondary" className="min-h-[36px]" data-testid="link-create-product">
                <Plus className="mr-1 h-4 w-4" />
                Add product
              </Button>
            </Link>
          </AlertDescription>
        </Alert>

        {/* Search and Actions */}
        <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 min-h-[44px]"
              data-testid="search-inventory"
            />
          </div>
          <Button onClick={() => refetch()} variant="outline" className="min-h-[44px]" data-testid="button-refresh">
            Refresh
          </Button>
        </div>

        {/* Products Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">Product Inventory</CardTitle>
            <CardDescription className="text-xs sm:text-sm">Manage stock levels and monitor inventory in real-time</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">Loading inventory...</div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-8">No products found</div>
            ) : (
              <>
                {/* Mobile Card View */}
                <div className="block lg:hidden space-y-3">
                  {filteredProducts.map((product) => {
                    const stockStatus = getStockStatus(product);
                    const stockPercentage = (product.stock / product.stockLimit) * 100;
                    
                    return (
                      <Card key={product.id} className="border-2" data-testid={`inventory-card-${product.id}`}>
                        <CardContent className="p-4">
                          <div className="space-y-3">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="font-semibold text-base">{product.name}</div>
                                <div className="text-xs text-muted-foreground">SKU: {product.productId}</div>
                                {product.barcode && (
                                  <div className="text-xs text-muted-foreground">{product.barcode}</div>
                                )}
                              </div>
                              <Badge variant={stockStatus.variant}>{stockStatus.status}</Badge>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div>
                                <div className="text-xs text-muted-foreground">Cost Price</div>
                                <div className="font-medium">
                                  ${typeof product.costPrice === 'string' 
                                    ? parseFloat(product.costPrice).toFixed(2) 
                                    : (product.costPrice || 0).toFixed(2)}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">Sale Price</div>
                                <div className="font-medium">
                                  ${typeof product.defaultSalePrice === 'string' 
                                    ? parseFloat(product.defaultSalePrice).toFixed(2) 
                                    : product.defaultSalePrice.toFixed(2)}
                                </div>
                              </div>
                            </div>
                            
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-muted-foreground">Stock Level</span>
                                <span className={`text-sm font-medium ${stockStatus.color}`}>
                                  {product.stock} / {product.stockLimit}
                                </span>
                              </div>
                              <Progress value={stockPercentage} className="h-2" />
                            </div>
                            
                            <div className="flex gap-2 pt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openAdjustmentDialog(product, "add")}
                                className="flex-1 min-h-[44px]"
                                data-testid={`button-add-stock-${product.id}`}
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add Stock
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openAdjustmentDialog(product, "set")}
                                className="flex-1 min-h-[44px]"
                                data-testid={`button-set-stock-${product.id}`}
                              >
                                Set Level
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Desktop Table View */}
                <div className="hidden lg:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Cost Price</TableHead>
                        <TableHead>Sale Price</TableHead>
                        <TableHead>Stock Level</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProducts.map((product) => {
                        const stockStatus = getStockStatus(product);
                        const stockPercentage = (product.stock / product.stockLimit) * 100;
                        
                        return (
                          <TableRow key={product.id} data-testid={`inventory-row-${product.id}`}>
                            <TableCell>
                              <div>
                                <div className="font-medium">{product.name}</div>
                                {product.barcode && (
                                  <div className="text-xs text-muted-foreground">{product.barcode}</div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{product.productId}</TableCell>
                            <TableCell>
                              ${typeof product.costPrice === 'string' 
                                ? parseFloat(product.costPrice).toFixed(2) 
                                : (product.costPrice || 0).toFixed(2)}
                            </TableCell>
                            <TableCell>
                              ${typeof product.defaultSalePrice === 'string' 
                                ? parseFloat(product.defaultSalePrice).toFixed(2) 
                                : product.defaultSalePrice.toFixed(2)}
                            </TableCell>
                            <TableCell>
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className={`font-medium ${stockStatus.color}`}>
                                    {product.stock} / {product.stockLimit}
                                  </span>
                                </div>
                                <Progress value={stockPercentage} className="h-2" />
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={stockStatus.variant}>{stockStatus.status}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openAdjustmentDialog(product, "add")}
                                  data-testid={`button-add-stock-${product.id}`}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openAdjustmentDialog(product, "set")}
                                  data-testid={`button-set-stock-${product.id}`}
                                >
                                  Set
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Stock Adjustment Dialog */}
      <Dialog open={adjustmentDialogOpen} onOpenChange={setAdjustmentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {adjustmentType === "add" ? "Adjust Stock" : "Set Stock Level"}
            </DialogTitle>
            <DialogDescription>
              {selectedProduct && (
                <div className="mt-2">
                  <p className="font-medium">{selectedProduct.name}</p>
                  <p className="text-sm">Current stock: {selectedProduct.stock}</p>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Input
              type="number"
              placeholder={adjustmentType === "add" ? "Enter adjustment amount (+ or -)" : "Enter new stock level"}
              value={adjustmentValue}
              onChange={(e) => setAdjustmentValue(e.target.value)}
              className="min-h-[44px]"
              data-testid="input-adjustment"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAdjustmentDialogOpen(false)} className="min-h-[44px]">
              Cancel
            </Button>
            <Button 
              onClick={handleStockAdjustment} 
              disabled={!adjustmentValue || adjustStockMutation.isPending}
              className="min-h-[44px]"
              data-testid="button-confirm-adjustment"
            >
              {adjustStockMutation.isPending ? "Updating..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}