import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient, apiRequest } from '@/lib/queryClient'
import { type Customer } from '@shared/schema'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { Plus, Edit, Trash2, UserPlus, Search, Phone, Mail, MapPin, Award } from 'lucide-react'

export default function Customers() {
  const { toast } = useToast()
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<any>(null)
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    category: 'Bronze',
  })

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ['/api/customers'],
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/customers', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] })
      setShowAddDialog(false)
      resetForm()
      toast({
        title: 'Success',
        description: 'Customer created successfully',
      })
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to create customer',
        variant: 'destructive',
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest(`/api/customers/${id}`, 'PUT', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] })
      setEditingCustomer(null)
      resetForm()
      toast({
        title: 'Success',
        description: 'Customer updated successfully',
      })
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to update customer',
        variant: 'destructive',
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/customers/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] })
      toast({
        title: 'Success',
        description: 'Customer deleted successfully',
      })
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to delete customer',
        variant: 'destructive',
      })
    },
  })

  const AUTOSAVE_KEY = 'customer_form_autosave'

  // Load autosaved data when dialog opens
  useEffect(() => {
    if (showAddDialog && !editingCustomer) {
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
  }, [showAddDialog, editingCustomer])

  // Auto-save form data to localStorage
  const autoSaveFormData = (updatedData: typeof formData) => {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(updatedData))
  }

  const resetForm = () => {
    const defaultData = {
      name: '',
      phone: '',
      email: '',
      address: '',
      category: 'Bronze',
    }
    setFormData(defaultData)
    localStorage.removeItem(AUTOSAVE_KEY)
  }

  const handleSubmit = () => {
    if (!formData.name) {
      toast({
        title: 'Error',
        description: 'Customer name is required',
        variant: 'destructive',
      })
      return
    }

    if (editingCustomer) {
      updateMutation.mutate({ id: editingCustomer.id, data: formData })
    } else {
      createMutation.mutate(formData)
    }
    
    // Clear autosave after successful submission
    localStorage.removeItem(AUTOSAVE_KEY)
  }

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer)
    setFormData({
      name: customer.name,
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      category: customer.category || 'Bronze',
    })
  }

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this customer?')) {
      deleteMutation.mutate(id)
    }
  }

  const filteredCustomers = customers.filter((customer) => 
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.phone?.includes(searchTerm)
  )

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'Gold': return 'bg-yellow-500'
      case 'Silver': return 'bg-gray-400'
      case 'Bronze': return 'bg-amber-600'
      default: return 'bg-blue-500'
    }
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
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 sm:mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Customer Database</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">Manage your customer records and information</p>
          </div>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button className="gap-2 min-h-[44px] w-full sm:w-auto" data-testid="button-add-customer">
                <UserPlus className="h-4 w-4" />
                Add Customer
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Customer</DialogTitle>
                <DialogDescription>
                  Enter customer information to create a new record
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
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
                    placeholder="John Doe"
                    className="min-h-[44px]"
                    data-testid="input-customer-name"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => {
                      const updated = { ...formData, phone: e.target.value }
                      setFormData(updated)
                    }}
                    onBlur={() => autoSaveFormData(formData)}
                    placeholder="+44 1234 567890"
                    className="min-h-[44px]"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => {
                      const updated = { ...formData, email: e.target.value }
                      setFormData(updated)
                    }}
                    onBlur={() => autoSaveFormData(formData)}
                    placeholder="customer@example.com"
                    className="min-h-[44px]"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="address">Billing Address</Label>
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => {
                      const updated = { ...formData, address: e.target.value }
                      setFormData(updated)
                    }}
                    onBlur={() => autoSaveFormData(formData)}
                    placeholder="123 Main Street, City"
                    className="min-h-[44px]"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="category">Category</Label>
                  <Select value={formData.category} onValueChange={(value) => {
                    const updated = { ...formData, category: value }
                    setFormData(updated)
                    autoSaveFormData(updated)
                  }}>
                    <SelectTrigger className="min-h-[44px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Bronze">Bronze</SelectItem>
                      <SelectItem value="Silver">Silver</SelectItem>
                      <SelectItem value="Gold">Gold</SelectItem>
                      <SelectItem value="Platinum">Platinum</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setShowAddDialog(false)} className="min-h-[44px]">
                  Cancel
                </Button>
                <Button onClick={handleSubmit} disabled={createMutation.isPending} className="min-h-[44px]">
                  {createMutation.isPending ? 'Creating...' : 'Create Customer'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4 mb-4 sm:mb-6">
          <Card>
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center gap-3">
                <UserPlus className="h-4 w-4 text-muted-foreground" />
                <div className="text-xs sm:text-sm font-medium text-muted-foreground">Total Customers</div>
              </div>
              <div className="text-2xl font-bold mt-2">
                {customers.length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center gap-3">
                <Award className="h-4 w-4 text-yellow-500" />
                <div className="text-xs sm:text-sm font-medium text-muted-foreground">Gold</div>
              </div>
              <div className="text-2xl font-bold mt-2">
                {customers.filter((c: any) => c.category === 'Gold').length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center gap-3">
                <Award className="h-4 w-4 text-gray-400" />
                <div className="text-xs sm:text-sm font-medium text-muted-foreground">Silver</div>
              </div>
              <div className="text-2xl font-bold mt-2">
                {customers.filter((c: any) => c.category === 'Silver').length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center gap-3">
                <Award className="h-4 w-4 text-amber-600" />
                <div className="text-xs sm:text-sm font-medium text-muted-foreground">Bronze</div>
              </div>
              <div className="text-2xl font-bold mt-2">
                {customers.filter((c: any) => c.category === 'Bronze').length}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mb-4 sm:mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 min-h-[44px]"
              data-testid="input-search-customers"
            />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">Customer List</CardTitle>
            <CardDescription className="text-xs sm:text-sm">View and manage all customer records</CardDescription>
          </CardHeader>
          <CardContent>
            {filteredCustomers.length === 0 && (
              <div className="text-center text-muted-foreground py-8">No customers found</div>
            )}

            {filteredCustomers.length > 0 && (
              <div>
                <div className="block lg:hidden space-y-3">
                  {filteredCustomers.map((customer: any) => (
                    <Card key={customer.id} className="border-2" data-testid={`customer-card-${customer.id}`}>
                      <CardContent className="p-4">
                        <div className="space-y-3">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="font-semibold text-base">{customer.name}</div>
                              <Badge className={`${getCategoryColor(customer.category)} mt-1`}>
                                {customer.category}
                              </Badge>
                            </div>
                          </div>

                          {(customer.phone || customer.email) && (
                            <div className="space-y-1 text-sm">
                              {customer.phone && (
                                <div className="flex items-center gap-2">
                                  <Phone className="h-3 w-3 text-muted-foreground" />
                                  <span>{customer.phone}</span>
                                </div>
                              )}
                              {customer.email && (
                                <div className="flex items-center gap-2">
                                  <Mail className="h-3 w-3 text-muted-foreground" />
                                  <span className="truncate">{customer.email}</span>
                                </div>
                              )}
                            </div>
                          )}

                          {customer.address && (
                            <div className="flex items-start gap-2 text-sm text-muted-foreground">
                              <MapPin className="h-3 w-3 text-muted-foreground mt-0.5" />
                              <span className="text-xs">{customer.address}</span>
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-2 pt-2 border-t text-sm">
                            <div>
                              <div className="text-xs text-muted-foreground">Points</div>
                              <div className="font-medium">{customer.loyaltyPoints || 0}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Total Spent</div>
                              <div className="font-medium">£{(parseFloat(customer.totalSpent as any) || 0).toFixed(2)}</div>
                            </div>
                          </div>

                          <div className="flex gap-2 pt-2">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEdit(customer)}
                                  className="flex-1 min-h-[44px]"
                                  data-testid={`button-edit-${customer.id}`}
                                >
                                  <Edit className="h-4 w-4 mr-2" />
                                  Edit
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Edit Customer</DialogTitle>
                                  <DialogDescription>Update customer information</DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                  <div className="grid gap-2">
                                    <Label htmlFor="edit-name-mobile">Name *</Label>
                                    <Input
                                      id="edit-name-mobile"
                                      value={formData.name}
                                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                      className="min-h-[44px]"
                                    />
                                  </div>
                                  <div className="grid gap-2">
                                    <Label htmlFor="edit-phone-mobile">Phone</Label>
                                    <Input
                                      id="edit-phone-mobile"
                                      value={formData.phone}
                                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                      className="min-h-[44px]"
                                    />
                                  </div>
                                  <div className="grid gap-2">
                                    <Label htmlFor="edit-email-mobile">Email</Label>
                                    <Input
                                      id="edit-email-mobile"
                                      type="email"
                                      value={formData.email}
                                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                      className="min-h-[44px]"
                                    />
                                  </div>
                                  <div className="grid gap-2">
                                    <Label htmlFor="edit-address-mobile">Billing Address</Label>
                                    <Input
                                      id="edit-address-mobile"
                                      value={formData.address}
                                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                      className="min-h-[44px]"
                                    />
                                  </div>
                                  <div className="grid gap-2">
                                    <Label htmlFor="edit-category-mobile">Category</Label>
                                    <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                                      <SelectTrigger className="min-h-[44px]">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="Bronze">Bronze</SelectItem>
                                        <SelectItem value="Silver">Silver</SelectItem>
                                        <SelectItem value="Gold">Gold</SelectItem>
                                        <SelectItem value="Platinum">Platinum</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                <DialogFooter className="gap-2">
                                  <Button variant="outline" onClick={() => setEditingCustomer(null)} className="min-h-[44px]">
                                    Cancel
                                  </Button>
                                  <Button onClick={handleSubmit} disabled={updateMutation.isPending} className="min-h-[44px]">
                                    {updateMutation.isPending ? 'Updating...' : 'Update Customer'}
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDelete(customer.id)}
                              className="flex-1 min-h-[44px]"
                              data-testid={`button-delete-${customer.id}`}
                            >
                              <Trash2 className="h-4 w-4 mr-2 text-destructive" />
                              Delete
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="hidden lg:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Loyalty Points</TableHead>
                        <TableHead>Total Spent</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCustomers.map((customer: any) => (
                        <TableRow key={customer.id} data-testid={`customer-row-${customer.id}`}>
                          <TableCell className="font-medium">{customer.name}</TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {customer.phone && (
                                <div className="flex items-center gap-1 text-sm">
                                  <Phone className="h-3 w-3" />
                                  {customer.phone}
                                </div>
                              )}
                              {customer.email && (
                                <div className="flex items-center gap-1 text-sm">
                                  <Mail className="h-3 w-3" />
                                  {customer.email}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {customer.address && (
                              <div className="flex items-start gap-1 text-sm">
                                <MapPin className="h-3 w-3" />
                                {customer.address}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge className={getCategoryColor(customer.category)}>
                              {customer.category}
                            </Badge>
                          </TableCell>
                          <TableCell>{customer.loyaltyPoints || 0}</TableCell>
                          <TableCell>£{(parseFloat(customer.totalSpent as any) || 0).toFixed(2)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleEdit(customer)}
                                    data-testid={`button-edit-${customer.id}`}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>Edit Customer</DialogTitle>
                                    <DialogDescription>Update customer information</DialogDescription>
                                  </DialogHeader>
                                  <div className="grid gap-4 py-4">
                                    <div className="grid gap-2">
                                      <Label htmlFor="edit-name">Name *</Label>
                                      <Input
                                        id="edit-name"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="min-h-[44px]"
                                      />
                                    </div>
                                    <div className="grid gap-2">
                                      <Label htmlFor="edit-phone">Phone</Label>
                                      <Input
                                        id="edit-phone"
                                        value={formData.phone}
                                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                        className="min-h-[44px]"
                                      />
                                    </div>
                                    <div className="grid gap-2">
                                      <Label htmlFor="edit-email">Email</Label>
                                      <Input
                                        id="edit-email"
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className="min-h-[44px]"
                                      />
                                    </div>
                                    <div className="grid gap-2">
                                      <Label htmlFor="edit-address">Billing Address</Label>
                                      <Input
                                        id="edit-address"
                                        value={formData.address}
                                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                        className="min-h-[44px]"
                                      />
                                    </div>
                                    <div className="grid gap-2">
                                      <Label htmlFor="edit-category">Category</Label>
                                      <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                                        <SelectTrigger className="min-h-[44px]">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="Bronze">Bronze</SelectItem>
                                          <SelectItem value="Silver">Silver</SelectItem>
                                          <SelectItem value="Gold">Gold</SelectItem>
                                          <SelectItem value="Platinum">Platinum</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  </div>
                                  <DialogFooter className="gap-2">
                                    <Button variant="outline" onClick={() => setEditingCustomer(null)} className="min-h-[44px]">
                                      Cancel
                                    </Button>
                                    <Button onClick={handleSubmit} disabled={updateMutation.isPending} className="min-h-[44px]">
                                      {updateMutation.isPending ? 'Updating...' : 'Update Customer'}
                                    </Button>
                                  </DialogFooter>
                                </DialogContent>
                              </Dialog>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(customer.id)}
                                data-testid={`button-delete-${customer.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
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
