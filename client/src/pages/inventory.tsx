import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
      const response = await apiRequest("PATCH", `/api/inventory/${data.productId}`, {
        adjustment: data.adjustment,
        type: data.type
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Stock Updated",
        description: "Product stock has been successfully adjusted.",
      });
      setAdjustmentDialogOpen(false);
      setSelectedProduct(null);
      setAdjustmentValue("");
      refetch();
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update stock",
        variant: "destructive",
      });
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
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-10 h-10 bg-accent rounded-lg">
                <Package className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Inventory Management</h1>
                <p className="text-xs text-slate-400">Real-time Stock Tracking</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" className="text-white" data-testid="link-home">
                <Link href="/">
                  <Home className="mr-2 h-4 w-4" />
                  Dashboard
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Alerts Section */}
        {(lowStockProducts.length > 0 || outOfStockProducts.length > 0) && (
          <div className="mb-6 space-y-4">
            {outOfStockProducts.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Out of Stock Alert</AlertTitle>
                <AlertDescription>
                  {outOfStockProducts.length} product{outOfStockProducts.length !== 1 ? 's are' : ' is'} out of stock:
                  {' '}{outOfStockProducts.slice(0, 3).map(p => p.name).join(', ')}
                  {outOfStockProducts.length > 3 && ` and ${outOfStockProducts.length - 3} more`}
                </AlertDescription>
              </Alert>
            )}
            {lowStockProducts.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Low Stock Warning</AlertTitle>
                <AlertDescription>
                  {lowStockProducts.length} product{lowStockProducts.length !== 1 ? 's have' : ' has'} low stock:
                  {' '}{lowStockProducts.slice(0, 3).map(p => p.name).join(', ')}
                  {lowStockProducts.length > 3 && ` and ${lowStockProducts.length - 3} more`}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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
                  return sum + (price * p.stock);
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

        {/* Search and Actions */}
        <div className="mb-6 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by product name, SKU, or barcode..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="search-inventory"
            />
          </div>
          <Button onClick={() => refetch()} variant="outline" data-testid="button-refresh">
            Refresh
          </Button>
        </div>

        {/* Products Table */}
        <Card>
          <CardHeader>
            <CardTitle>Product Inventory</CardTitle>
            <CardDescription>Manage stock levels and monitor inventory in real-time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
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
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">Loading inventory...</TableCell>
                    </TableRow>
                  ) : filteredProducts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">No products found</TableCell>
                    </TableRow>
                  ) : (
                    filteredProducts.map((product) => {
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
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
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
              data-testid="input-adjustment"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustmentDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleStockAdjustment} 
              disabled={!adjustmentValue || adjustStockMutation.isPending}
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