import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient, apiRequest } from '@/lib/queryClient'
import { invalidateAfterCatalogMutation } from '@/lib/query-invalidation'
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
import { PRODUCT_IMPORT_CSV_SAMPLE } from '@shared/setup'
import {
  parseProductCsvText,
  previewProductImportFromMappedRows,
  type ProductImportPreview,
} from '@shared/productImport'
import { downloadBlob } from '@/lib/fileImport'

export default function ProductManagement() {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingProduct, setEditingProduct] = useState<any>(null)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [csvContent, setCsvContent] = useState('')
  const [csvPreview, setCsvPreview] = useState<ProductImportPreview | null>(null)
  const [importResults, setImportResults] = useState<any>(null)
  const [formData, setFormData] = useState({
    productCode: '',
    name: '',
    barcode: '',
    costPrice: '',
    salePrice: '',
    stock: '',
    stockLimit: '',
    categoryId: ''
  })

  // Fetch products
  const { data: products = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/products'],
  })

  const refreshAfterProductMutation = async () => {
    await invalidateAfterCatalogMutation(queryClient)
  }

  // Create product mutation
  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/products', data),
    onSuccess: async () => {
      await refreshAfterProductMutation()
      setShowAddDialog(false)
      resetForm()
      toast({
        title: 'Success',
        description: 'Product created successfully',
      })
    },
    onError: (error: any) => {
      const errorMessage = error?.response?.data?.message || error?.message || 'Failed to create product'
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      })
    },
  })

  // Update product mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest('PUT', `/api/products/${id}`, data),
    onSuccess: async () => {
      await refreshAfterProductMutation()
      setEditingProduct(null)
      resetForm()
      toast({
        title: 'Success',
        description: 'Product updated successfully',
      })
    },
    onError: (error: any) => {
      const errorMessage = error?.response?.data?.message || error?.message || 'Failed to update product'
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      })
    },
  })

  // Delete product mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/products/${id}`),
    onSuccess: async () => {
      await refreshAfterProductMutation()
      toast({
        title: 'Success',
        description: 'Product deleted successfully',
      })
    },
    onError: (error: any) => {
      const errorMessage = error?.response?.data?.message || error?.message || 'Failed to delete product'
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      })
    },
  })

  // Import products mutation
  const importMutation = useMutation({
    mutationFn: (rows: Record<string, unknown>[]) =>
      apiRequest('POST', '/api/products/import', {
        rows,
        confirmed: true,
        duplicateMode: 'skip',
      }),
    onSuccess: async (data: any) => {
      await refreshAfterProductMutation()
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

  const AUTOSAVE_KEY = 'product_form_autosave'

  // Load autosaved data when dialog opens
  useEffect(() => {
    if (showAddDialog && !editingProduct) {
      const saved = localStorage.getItem(AUTOSAVE_KEY)
      if (saved) {
        try {
          const parsedData = JSON.parse(saved)
          setFormData(parsedData)
          toast({
            title: 'Draft Restored',
            description: 'Your previous work has been restored',
          })
        } catch (e) {
          console.error('Failed to parse autosaved data')
        }
      }
    }
  }, [showAddDialog, editingProduct])

  // Auto-save form data to localStorage
  const autoSaveFormData = (updatedData: typeof formData) => {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(updatedData))
  }

  const resetForm = () => {
    const defaultData = {
      productCode: '',
      name: '',
      barcode: '',
      costPrice: '',
      salePrice: '',
      stock: '',
      stockLimit: '',
      categoryId: ''
    }
    setFormData(defaultData)
    localStorage.removeItem(AUTOSAVE_KEY)
  }

  const handleSubmit = () => {
    if (!formData.name || !formData.salePrice) {
      toast({
        title: 'Error',
        description: 'Product name and sale price are required',
        variant: 'destructive',
      })
      return
    }

    const productData = {
      ...formData,
      costPrice: formData.costPrice ? parseFloat(formData.costPrice) : 0,
      salePrice: parseFloat(formData.salePrice),
      stock: formData.stock ? parseInt(formData.stock) : 0,
      stockLimit: formData.stockLimit ? parseInt(formData.stockLimit) : 100,
    }

    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data: productData })
    } else {
      createMutation.mutate(productData)
    }
    
    // Clear autosave after successful submission
    localStorage.removeItem(AUTOSAVE_KEY)
  }

  const handleEdit = (product: any) => {
    setEditingProduct(product)
    setFormData({
      productCode: product.productCode || product.productId || '',
      name: product.name,
      barcode: product.barcode || '',
      costPrice: (product.costPrice || '').toString(),
      salePrice: (product.salePrice || product.defaultSalePrice || '').toString(),
      stock: (product.stock || '').toString(),
      stockLimit: (product.stockLimit || '').toString(),
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
        refreshCsvPreview(content)
        setShowImportDialog(true)
      }
      reader.readAsText(file)
    }
  }

  const refreshCsvPreview = (content: string) => {
    const mapped = parseProductCsvText(content)
    setCsvPreview(previewProductImportFromMappedRows(mapped))
  }

  const handleImport = () => {
    const preview = csvPreview ?? previewProductImportFromMappedRows(parseProductCsvText(csvContent))
    const validRows = preview.rows
      .filter((r) => r.errors.length === 0)
      .map((r) => r.data)

    if (validRows.length === 0) {
      const firstErrors = preview.rows
        .filter((r) => r.errors.length > 0)
        .slice(0, 3)
        .map((r) => `Row ${r.rowIndex}: ${r.errors.join('; ')}`)
        .join(' ')
      toast({
        title: 'No valid products',
        description:
          firstErrors ||
          'Fix sale price (use 9.99 not £9.99), name, and other fields. See row errors below.',
        variant: 'destructive',
      })
      return
    }
    importMutation.mutate(validRows)
  }

  const downloadTemplate = () => {
    downloadBlob(PRODUCT_IMPORT_CSV_SAMPLE, 'products-template.csv')
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* Header */}
        <div className="flex flex-col gap-4 mb-4 sm:mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Product Management</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">Add, edit, and manage your product catalog</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="gap-2 min-h-[44px]"
              onClick={downloadTemplate}
              data-testid="button-download-template"
            >
              <Download className="h-4 w-4" />
              CSV Template
            </Button>
            <Button
              variant="outline"
              className="gap-2 min-h-[44px]"
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
                <Button className="gap-2 min-h-[44px]" data-testid="button-add-product">
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
                      id="productCode"
                      value={formData.productCode}
                      onChange={(e) => {
                        const updated = { ...formData, productCode: e.target.value }
                        setFormData(updated)
                      }}
                      onBlur={() => autoSaveFormData(formData)}
                      placeholder="PRD001 (optional)"
                      className="min-h-[44px]"
                      data-testid="input-product-id"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => {
                        const updated = { ...formData, name: e.target.value }
                        setFormData(updated)
                      }}
                      onBlur={() => autoSaveFormData(formData)}
                      placeholder="Product Name"
                      className="min-h-[44px]"
                      data-testid="input-product-name"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="barcode">Barcode</Label>
                    <Input
                      id="barcode"
                      value={formData.barcode}
                      onChange={(e) => {
                        const updated = { ...formData, barcode: e.target.value }
                        setFormData(updated)
                      }}
                      onBlur={() => autoSaveFormData(formData)}
                      placeholder="123456789"
                      className="min-h-[44px]"
                      data-testid="input-product-barcode"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="costPrice">Cost Price</Label>
                      <Input
                        id="costPrice"
                        type="number"
                        step="0.01"
                        value={formData.costPrice}
                        onChange={(e) => {
                          const updated = { ...formData, costPrice: e.target.value }
                          setFormData(updated)
                        }}
                        onBlur={() => autoSaveFormData(formData)}
                        placeholder="5.00"
                        className="min-h-[44px]"
                        data-testid="input-product-cost-price"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="salePrice">Sale Price *</Label>
                      <Input
                        id="salePrice"
                        type="number"
                        step="0.01"
                        value={formData.salePrice}
                        onChange={(e) => {
                          const updated = { ...formData, salePrice: e.target.value }
                          setFormData(updated)
                        }}
                        onBlur={() => autoSaveFormData(formData)}
                        placeholder="9.99"
                        className="min-h-[44px]"
                        data-testid="input-product-sale-price"
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
                        onChange={(e) => {
                          const updated = { ...formData, stock: e.target.value }
                          setFormData(updated)
                        }}
                        onBlur={() => autoSaveFormData(formData)}
                        placeholder="100"
                        className="min-h-[44px]"
                        data-testid="input-product-stock"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="stockLimit">Stock Limit</Label>
                      <Input
                        id="stockLimit"
                        type="number"
                        value={formData.stockLimit}
                        onChange={(e) => {
                          const updated = { ...formData, stockLimit: e.target.value }
                          setFormData(updated)
                        }}
                        onBlur={() => autoSaveFormData(formData)}
                        placeholder="500"
                        className="min-h-[44px]"
                        data-testid="input-product-stock-limit"
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setShowAddDialog(false)} className="min-h-[44px]">
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} disabled={createMutation.isPending} className="min-h-[44px]" data-testid="button-save-product">
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
                }} className="min-h-[44px]">
                  Close
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>CSV Content Preview</Label>
                  <Textarea
                    value={csvContent}
                    onChange={(e) => {
                      setCsvContent(e.target.value)
                      refreshCsvPreview(e.target.value)
                    }}
                    rows={10}
                    className="font-mono text-sm"
                  />
                  {csvPreview && (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {csvPreview.summary.valid} valid · {csvPreview.summary.invalid} invalid ·{' '}
                        {csvPreview.summary.total} rows
                      </p>
                      {csvPreview.summary.invalid > 0 && (
                        <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Fix invalid rows</AlertTitle>
                          <AlertDescription>
                            <ul className="list-disc pl-5 mt-2 space-y-1 text-sm">
                              {csvPreview.rows
                                .filter((r) => r.errors.length > 0)
                                .slice(0, 15)
                                .map((r) => (
                                  <li key={r.rowIndex}>
                                    Row {r.rowIndex}: {r.errors.join('; ')}
                                  </li>
                                ))}
                            </ul>
                            <p className="mt-2 text-xs">
                              Prices must be numbers only (e.g. 4.00). Remove £ symbols or use the
                              download template.
                            </p>
                          </AlertDescription>
                        </Alert>
                      )}
                    </>
                  )}
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => {
                    setShowImportDialog(false)
                    setCsvContent('')
                  }} className="min-h-[44px]">
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleImport} 
                    disabled={importMutation.isPending || !csvPreview?.summary.valid}
                    className="min-h-[44px]"
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-4 sm:p-6">
              <CardTitle className="text-xs sm:text-sm font-medium">Total Products</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0">
              <div className="text-xl sm:text-2xl font-bold">{products.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-4 sm:p-6">
              <CardTitle className="text-xs sm:text-sm font-medium">In Stock</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0">
              <div className="text-xl sm:text-2xl font-bold">
                {products.filter((p: any) => p.stock > 0).length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-4 sm:p-6">
              <CardTitle className="text-xs sm:text-sm font-medium">Low Stock</CardTitle>
              <AlertCircle className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0">
              <div className="text-xl sm:text-2xl font-bold">
                {products.filter((p: any) => {
                  const stockPercentage = (p.stock / (p.stockLimit || 100)) * 100
                  return stockPercentage <= 20 && p.stock > 0
                }).length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-4 sm:p-6">
              <CardTitle className="text-xs sm:text-sm font-medium">Out of Stock</CardTitle>
              <X className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0">
              <div className="text-xl sm:text-2xl font-bold">
                {products.filter((p: any) => p.stock === 0).length}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="mb-4 sm:mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search products by name, ID, or barcode..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 min-h-[44px]"
              data-testid="input-search-products"
            />
          </div>
        </div>

        {/* Products Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">Product Catalog</CardTitle>
            <CardDescription className="text-xs sm:text-sm">Manage your complete product inventory</CardDescription>
          </CardHeader>
          <CardContent>
            {filteredProducts.length === 0 && (
              <div className="text-center text-muted-foreground py-8">No products found</div>
            )}

            {filteredProducts.length > 0 && (
              <div>
                {/* Mobile Card View */}
                <div className="block lg:hidden space-y-3">
                  {filteredProducts.map((product: any) => {
                    const stockStatus = getStockStatus(product)
                    return (
                      <Card key={product.id} className="border-2" data-testid={`product-card-${product.id}`}>
                        <CardContent className="p-4">
                          <div className="space-y-3">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="font-semibold text-base">{product.name}</div>
                                {product.productId && (
                                  <div className="text-xs font-mono text-muted-foreground mt-0.5">{product.productId}</div>
                                )}
                              </div>
                              <Badge variant={stockStatus.variant} className="ml-2">
                                {stockStatus.status}
                              </Badge>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <div className="text-xs text-muted-foreground">Price</div>
                                <div className="font-medium">${(parseFloat(product.price || product.defaultSalePrice || '0')).toFixed(2)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">Stock</div>
                                <div className="font-medium">{product.stock} / {product.stockLimit || 100}</div>
                              </div>
                              {product.barcode && (
                                <div>
                                  <div className="text-xs text-muted-foreground">Barcode</div>
                                  <div className="font-mono text-xs">{product.barcode}</div>
                                </div>
                              )}
                              {(product.tax || product.costPrice) && (
                                <div>
                                  <div className="text-xs text-muted-foreground">Cost</div>
                                  <div className="font-medium">${parseFloat(product.tax || product.costPrice || '0').toFixed(2)}</div>
                                </div>
                              )}
                            </div>

                            <div className="flex gap-2 pt-2 border-t">
                              <Dialog open={editingProduct?.id === product.id} onOpenChange={(open) => !open && setEditingProduct(null)}>
                                <DialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleEdit(product)}
                                    className="flex-1 min-h-[44px]"
                                    data-testid={`button-edit-${product.id}`}
                                  >
                                    <Edit className="h-4 w-4 mr-2" />
                                    Edit
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-md">
                                  <DialogHeader>
                                    <DialogTitle>Edit Product</DialogTitle>
                                    <DialogDescription>Update product information</DialogDescription>
                                  </DialogHeader>
                                  <div className="grid gap-4 py-4">
                                    <div className="grid gap-2">
                                      <Label htmlFor="edit-productId-mobile">Product ID</Label>
                                      <Input
                                        id="edit-productId-mobile"
                                        value={formData.productCode}
                                        onChange={(e) => setFormData({ ...formData, productCode: e.target.value })}
                                        placeholder="PRD001"
                                        className="min-h-[44px]"
                                      />
                                    </div>
                                    <div className="grid gap-2">
                                      <Label htmlFor="edit-name-mobile">Name *</Label>
                                      <Input
                                        id="edit-name-mobile"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="Product Name"
                                        className="min-h-[44px]"
                                      />
                                    </div>
                                    <div className="grid gap-2">
                                      <Label htmlFor="edit-barcode-mobile">Barcode</Label>
                                      <Input
                                        id="edit-barcode-mobile"
                                        value={formData.barcode}
                                        onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                                        placeholder="123456789"
                                        className="min-h-[44px]"
                                      />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                      <div className="grid gap-2">
                                        <Label htmlFor="edit-costPrice-mobile">Cost Price</Label>
                                        <Input
                                          id="edit-costPrice-mobile"
                                          type="number"
                                          step="0.01"
                                          value={formData.costPrice}
                                          onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })}
                                          placeholder="5.00"
                                          className="min-h-[44px]"
                                        />
                                      </div>
                                      <div className="grid gap-2">
                                        <Label htmlFor="edit-salePrice-mobile">Sale Price *</Label>
                                        <Input
                                          id="edit-salePrice-mobile"
                                          type="number"
                                          step="0.01"
                                          value={formData.salePrice}
                                          onChange={(e) => setFormData({ ...formData, salePrice: e.target.value })}
                                          placeholder="9.99"
                                          className="min-h-[44px]"
                                        />
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                      <div className="grid gap-2">
                                        <Label htmlFor="edit-stock-mobile">Stock</Label>
                                        <Input
                                          id="edit-stock-mobile"
                                          type="number"
                                          value={formData.stock}
                                          onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                                          placeholder="100"
                                          className="min-h-[44px]"
                                        />
                                      </div>
                                      <div className="grid gap-2">
                                        <Label htmlFor="edit-stockLimit-mobile">Stock Limit</Label>
                                        <Input
                                          id="edit-stockLimit-mobile"
                                          type="number"
                                          value={formData.stockLimit}
                                          onChange={(e) => setFormData({ ...formData, stockLimit: e.target.value })}
                                          placeholder="500"
                                          className="min-h-[44px]"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                  <DialogFooter className="gap-2">
                                    <Button variant="outline" onClick={() => setEditingProduct(null)} className="min-h-[44px]">
                                      Cancel
                                    </Button>
                                    <Button onClick={handleSubmit} disabled={updateMutation.isPending} className="min-h-[44px]">
                                      {updateMutation.isPending ? 'Updating...' : 'Update Product'}
                                    </Button>
                                  </DialogFooter>
                                </DialogContent>
                              </Dialog>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDelete(product.id)}
                                className="flex-1 min-h-[44px]"
                                data-testid={`button-delete-${product.id}`}
                              >
                                <Trash2 className="h-4 w-4 mr-2 text-destructive" />
                                Delete
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>

                {/* Desktop Table View */}
                <div className="hidden lg:block overflow-x-auto">
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
                      {filteredProducts.map((product: any) => {
                        const stockStatus = getStockStatus(product)
                        return (
                          <TableRow key={product.id} data-testid={`product-row-${product.id}`}>
                        <TableCell className="font-mono text-sm">{product.productId || '-'}</TableCell>
                        <TableCell className="font-medium">{product.name}</TableCell>
                        <TableCell className="font-mono text-sm">{product.barcode || '-'}</TableCell>
                        <TableCell>${(parseFloat(product.price || product.defaultSalePrice || '0')).toFixed(2)}</TableCell>
                        <TableCell>${parseFloat(product.tax || product.costPrice || '0').toFixed(2)}</TableCell>
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
                                      value={formData.productCode}
                                      onChange={(e) => setFormData({ ...formData, productCode: e.target.value })}
                                      placeholder="PRD001"
                                      className="min-h-[44px]"
                                    />
                                  </div>
                                  <div className="grid gap-2">
                                    <Label htmlFor="edit-name">Name *</Label>
                                    <Input
                                      id="edit-name"
                                      value={formData.name}
                                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                      placeholder="Product Name"
                                      className="min-h-[44px]"
                                    />
                                  </div>
                                  <div className="grid gap-2">
                                    <Label htmlFor="edit-barcode">Barcode</Label>
                                    <Input
                                      id="edit-barcode"
                                      value={formData.barcode}
                                      onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                                      placeholder="123456789"
                                      className="min-h-[44px]"
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                      <Label htmlFor="edit-costPrice">Cost Price</Label>
                                      <Input
                                        id="edit-costPrice"
                                        type="number"
                                        step="0.01"
                                        value={formData.costPrice}
                                        onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })}
                                        placeholder="5.00"
                                        className="min-h-[44px]"
                                      />
                                    </div>
                                    <div className="grid gap-2">
                                      <Label htmlFor="edit-salePrice">Sale Price *</Label>
                                      <Input
                                        id="edit-salePrice"
                                        type="number"
                                        step="0.01"
                                        value={formData.salePrice}
                                        onChange={(e) => setFormData({ ...formData, salePrice: e.target.value })}
                                        placeholder="9.99"
                                        className="min-h-[44px]"
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
                                        className="min-h-[44px]"
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
                                        className="min-h-[44px]"
                                      />
                                    </div>
                                  </div>
                                </div>
                                <DialogFooter className="gap-2">
                                  <Button variant="outline" onClick={() => setEditingProduct(null)} className="min-h-[44px]">
                                    Cancel
                                  </Button>
                                  <Button onClick={handleSubmit} disabled={updateMutation.isPending} className="min-h-[44px]">
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
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}