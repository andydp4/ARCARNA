import { useState, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient, apiRequest } from '@/lib/queryClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import {
  Plus,
  Edit,
  Trash2,
  Upload,
  Download,
  FileText,
  Package,
  Search,
  AlertCircle,
  CheckCircle,
  X
} from 'lucide-react'

export default function ProductManagement() {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingProduct, setEditingProduct] = useState<any>(null)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [csvContent, setCsvContent] = useState('')
  const [importResults, setImportResults] = useState<any>(null)
  const [formData, setFormData] = useState({
    productId: '',
    name: '',
    barcode: '',
    price: '',
    tax: '',
    stock: '',
    stockLimit: '',
    categoryId: ''
  })

  // Fetch products
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['/api/products'],
  })

  // Create product mutation
  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/products', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/products'] })
      queryClient.invalidateQueries({ queryKey: ['/api/inventory'] })
      setShowAddDialog(false)
      resetForm()
      toast({
        title: 'Success',
        description: 'Product created successfully',
      })
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to create product',
        variant: 'destructive',
      })
    },
  })

  // Update product mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest(`/api/products/${id}`, 'PUT', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/products'] })
      queryClient.invalidateQueries({ queryKey: ['/api/inventory'] })
      setEditingProduct(null)
      resetForm()
      toast({
        title: 'Success',
        description: 'Product updated successfully',
      })
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to update product',
        variant: 'destructive',
      })
    },
  })

  // Delete product mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/products/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/products'] })
      queryClient.invalidateQueries({ queryKey: ['/api/inventory'] })
      toast({
        title: 'Success',
        description: 'Product deleted successfully',
      })
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to delete product',
        variant: 'destructive',
      })
    },
  })

  // Import products mutation
  const importMutation = useMutation({
    mutationFn: (products: any[]) => apiRequest('/api/products/import', 'POST', { products }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/products'] })
      queryClient.invalidateQueries({ queryKey: ['/api/inventory'] })
      setImportResults(data)
      setCsvContent('')
      toast({
        title: 'Import Complete',
        description: `Imported: ${data.imported}, Failed: ${data.failed}`,
      })
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to import products',
        variant: 'destructive',
      })
    },
  })

  const resetForm = () => {
    setFormData({
      productId: '',
      name: '',
      barcode: '',
      price: '',
      tax: '',
      stock: '',
      stockLimit: '',
      categoryId: ''
    })
  }

  const handleSubmit = () => {
    if (!formData.name || !formData.price) {
      toast({
        title: 'Error',
        description: 'Product name and price are required',
        variant: 'destructive',
      })
      return
    }

    const productData = {
      ...formData,
      price: parseFloat(formData.price),
      tax: formData.tax ? parseFloat(formData.tax) : 0,
      stock: formData.stock ? parseInt(formData.stock) : 0,
      stockLimit: formData.stockLimit ? parseInt(formData.stockLimit) : 100,
    }

    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data: productData })
    } else {
      createMutation.mutate(productData)
    }
  }

  const handleEdit = (product: any) => {
    setEditingProduct(product)
    setFormData({
      productId: product.productId || '',
      name: product.name,
      barcode: product.barcode || '',
      price: product.price.toString(),
      tax: product.tax?.toString() || '',
      stock: product.stock?.toString() || '',
      stockLimit: product.stockLimit?.toString() || '',
      categoryId: product.categoryId || ''
    })
  }

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this product?')) {
      deleteMutation.mutate(id)
    }
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        setCsvContent(content)
        setShowImportDialog(true)
      }
      reader.readAsText(file)
    }
  }

  const parseCsvContent = (content: string): any[] => {
    const lines = content.split('\n').filter(line => line.trim())
    if (lines.length === 0) return []

    const headers = lines[0].split(',').map(h => h.trim())
    const products = []

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim())
      const product: any = {}

      headers.forEach((header, index) => {
        const value = values[index]
        switch (header.toLowerCase()) {
          case 'productid':
          case 'product_id':
            product.productId = value
            break
          case 'name':
            product.name = value
            break
          case 'barcode':
            product.barcode = value
            break
          case 'price':
            product.price = parseFloat(value) || 0
            break
          case 'tax':
            product.tax = parseFloat(value) || 0
            break
          case 'stock':
            product.stock = parseInt(value) || 0
            break
          case 'stocklimit':
          case 'stock_limit':
            product.stockLimit = parseInt(value) || 100
            break
          case 'category':
          case 'categoryid':
          case 'category_id':
            product.categoryId = value
            break
        }
      })

      if (product.name && product.price !== undefined) {
        products.push(product)
      }
    }

    return products
  }

  const handleImport = () => {
    const products = parseCsvContent(csvContent)
    if (products.length === 0) {
      toast({
        title: 'Error',
        description: 'No valid products found in CSV',
        variant: 'destructive',
      })
      return
    }
    importMutation.mutate(products)
  }

  const downloadTemplate = () => {
    const template = 'productId,name,barcode,price,tax,stock,stockLimit,category\nPRD001,Sample Product,123456789,9.99,0.15,100,500,Electronics\nPRD002,Another Product,987654321,19.99,0.15,50,200,Clothing'
    const blob = new Blob([template], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'product_import_template.csv'
    a.click()
  }

  const filteredProducts = products.filter((product: any) => 
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.productId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.barcode?.includes(searchTerm)
  )

  const getStockStatus = (product: any) => {
    const stockPercentage = (product.stock / (product.stockLimit || 100)) * 100
    if (product.stock === 0) {
      return { status: 'Out of Stock', variant: 'destructive' as const }
    } else if (stockPercentage <= 20) {
      return { status: 'Low Stock', variant: 'destructive' as const }
    } else if (stockPercentage <= 50) {
      return { status: 'Medium Stock', variant: 'secondary' as const }
    }
    return { status: 'In Stock', variant: 'outline' as const }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Product Management</h1>
            <p className="text-muted-foreground mt-1">Add, edit, and manage your product catalog</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={downloadTemplate}
              data-testid="button-download-template"
            >
              <Download className="h-4 w-4" />
              CSV Template
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => fileInputRef.current?.click()}
              data-testid="button-import-csv"
            >
              <Upload className="h-4 w-4" />
              Import CSV
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogTrigger asChild>
                <Button className="gap-2" data-testid="button-add-product">
                  <Plus className="h-4 w-4" />
                  Add Product
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Add New Product</DialogTitle>
                  <DialogDescription>
                    Enter product information to add to your catalog
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="productId">Product ID</Label>
                    <Input
                      id="productId"
                      value={formData.productId}
                      onChange={(e) => setFormData({ ...formData, productId: e.target.value })}
                      placeholder="PRD001 (optional)"
                      data-testid="input-product-id"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Product Name"
                      data-testid="input-product-name"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="barcode">Barcode</Label>
                    <Input
                      id="barcode"
                      value={formData.barcode}
                      onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                      placeholder="123456789"
                      data-testid="input-product-barcode"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="price">Price *</Label>
                      <Input
                        id="price"
                        type="number"
                        step="0.01"
                        value={formData.price}
                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                        placeholder="9.99"
                        data-testid="input-product-price"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="tax">Tax Rate</Label>
                      <Input
                        id="tax"
                        type="number"
                        step="0.01"
                        value={formData.tax}
                        onChange={(e) => setFormData({ ...formData, tax: e.target.value })}
                        placeholder="0.15"
                        data-testid="input-product-tax"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="stock">Initial Stock</Label>
                      <Input
                        id="stock"
                        type="number"
                        value={formData.stock}
                        onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                        placeholder="100"
                        data-testid="input-product-stock"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="stockLimit">Stock Limit</Label>
                      <Input
                        id="stockLimit"
                        type="number"
                        value={formData.stockLimit}
                        onChange={(e) => setFormData({ ...formData, stockLimit: e.target.value })}
                        placeholder="500"
                        data-testid="input-product-stock-limit"
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-save-product">
                    {createMutation.isPending ? 'Creating...' : 'Create Product'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* CSV Import Dialog */}
        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Import Products from CSV</DialogTitle>
              <DialogDescription>
                Review and confirm the products to import
              </DialogDescription>
            </DialogHeader>
            {importResults ? (
              <div className="space-y-4">
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertTitle>Import Complete</AlertTitle>
                  <AlertDescription>
                    Successfully imported {importResults.imported} products.
                    {importResults.failed > 0 && ` ${importResults.failed} failed.`}
                  </AlertDescription>
                </Alert>
                {importResults.errors?.length > 0 && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Errors</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc pl-5">
                        {importResults.errors.map((error: string, idx: number) => (
                          <li key={idx}>{error}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
                <Button onClick={() => {
                  setShowImportDialog(false)
                  setImportResults(null)
                }}>
                  Close
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>CSV Content Preview</Label>
                  <Textarea
                    value={csvContent}
                    onChange={(e) => setCsvContent(e.target.value)}
                    rows={10}
                    className="font-mono text-sm"
                  />
                  <p className="text-sm text-muted-foreground">
                    {parseCsvContent(csvContent).length} valid products found
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => {
                    setShowImportDialog(false)
                    setCsvContent('')
                  }}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleImport} 
                    disabled={importMutation.isPending}
                    data-testid="button-import-confirm"
                  >
                    {importMutation.isPending ? 'Importing...' : 'Import Products'}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Products</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{products.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">In Stock</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {products.filter((p: any) => p.stock > 0).length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Low Stock</CardTitle>
              <AlertCircle className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {products.filter((p: any) => {
                  const stockPercentage = (p.stock / (p.stockLimit || 100)) * 100
                  return stockPercentage <= 20 && p.stock > 0
                }).length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
              <X className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {products.filter((p: any) => p.stock === 0).length}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search products by name, ID, or barcode..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-products"
            />
          </div>
        </div>

        {/* Products Table */}
        <Card>
          <CardHeader>
            <CardTitle>Product Catalog</CardTitle>
            <CardDescription>Manage your complete product inventory</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Tax</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      No products found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProducts.map((product: any) => {
                    const stockStatus = getStockStatus(product)
                    return (
                      <TableRow key={product.id} data-testid={`product-row-${product.id}`}>
                        <TableCell className="font-mono text-sm">{product.productId || '-'}</TableCell>
                        <TableCell className="font-medium">{product.name}</TableCell>
                        <TableCell className="font-mono text-sm">{product.barcode || '-'}</TableCell>
                        <TableCell>${product.price.toFixed(2)}</TableCell>
                        <TableCell>{product.tax ? `${(product.tax * 100).toFixed(0)}%` : '-'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span>{product.stock}</span>
                            <span className="text-muted-foreground">/ {product.stockLimit || 100}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={stockStatus.variant}>
                            {stockStatus.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Dialog open={editingProduct?.id === product.id} onOpenChange={(open) => !open && setEditingProduct(null)}>
                              <DialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEdit(product)}
                                  data-testid={`button-edit-${product.id}`}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-md">
                                <DialogHeader>
                                  <DialogTitle>Edit Product</DialogTitle>
                                  <DialogDescription>
                                    Update product information
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                  <div className="grid gap-2">
                                    <Label htmlFor="edit-productId">Product ID</Label>
                                    <Input
                                      id="edit-productId"
                                      value={formData.productId}
                                      onChange={(e) => setFormData({ ...formData, productId: e.target.value })}
                                      placeholder="PRD001"
                                    />
                                  </div>
                                  <div className="grid gap-2">
                                    <Label htmlFor="edit-name">Name *</Label>
                                    <Input
                                      id="edit-name"
                                      value={formData.name}
                                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                      placeholder="Product Name"
                                    />
                                  </div>
                                  <div className="grid gap-2">
                                    <Label htmlFor="edit-barcode">Barcode</Label>
                                    <Input
                                      id="edit-barcode"
                                      value={formData.barcode}
                                      onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                                      placeholder="123456789"
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                      <Label htmlFor="edit-price">Price *</Label>
                                      <Input
                                        id="edit-price"
                                        type="number"
                                        step="0.01"
                                        value={formData.price}
                                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                        placeholder="9.99"
                                      />
                                    </div>
                                    <div className="grid gap-2">
                                      <Label htmlFor="edit-tax">Tax Rate</Label>
                                      <Input
                                        id="edit-tax"
                                        type="number"
                                        step="0.01"
                                        value={formData.tax}
                                        onChange={(e) => setFormData({ ...formData, tax: e.target.value })}
                                        placeholder="0.15"
                                      />
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                      <Label htmlFor="edit-stock">Stock</Label>
                                      <Input
                                        id="edit-stock"
                                        type="number"
                                        value={formData.stock}
                                        onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                                        placeholder="100"
                                      />
                                    </div>
                                    <div className="grid gap-2">
                                      <Label htmlFor="edit-stockLimit">Stock Limit</Label>
                                      <Input
                                        id="edit-stockLimit"
                                        type="number"
                                        value={formData.stockLimit}
                                        onChange={(e) => setFormData({ ...formData, stockLimit: e.target.value })}
                                        placeholder="500"
                                      />
                                    </div>
                                  </div>
                                </div>
                                <DialogFooter>
                                  <Button variant="outline" onClick={() => setEditingProduct(null)}>
                                    Cancel
                                  </Button>
                                  <Button onClick={handleSubmit} disabled={updateMutation.isPending}>
                                    {updateMutation.isPending ? 'Updating...' : 'Update Product'}
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(product.id)}
                              data-testid={`button-delete-${product.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}