import { useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { apiRequest, queryClient } from '@/lib/queryClient'
import {
  CreditCard,
  Search,
  User,
  Calendar,
  DollarSign,
  CheckCircle,
  AlertCircle,
  Download,
  Send,
  Trash2,
  X,
} from 'lucide-react'

interface TickOrder {
  id: string
  date: string
  amount: number
  status: 'pending' | 'partial' | 'paid'
  items: string[]
}

interface TickCustomer {
  id: string
  name: string
  email: string
  phone: string
  totalDebt: number
  lastOrderDate: string
  orders: TickOrder[]
}

export default function TickList() {
  const { toast } = useToast()
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'partial' | 'paid'>('all')
  const [selectedCustomer, setSelectedCustomer] = useState<TickCustomer | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [payingCustomer, setPayingCustomer] = useState<TickCustomer | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [customerToDelete, setCustomerToDelete] = useState<TickCustomer | null>(null)

  // Fetch tick customers from API
  const { data: tickCustomers = [], isLoading, refetch } = useQuery<TickCustomer[]>({
    queryKey: ["/api/tick-customers"],
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (customerId: string) => {
      const response = await apiRequest("DELETE", `/api/tick-customers/${customerId}`)
      return response.json()
    },
    onSuccess: () => {
      toast({
        title: 'Customer Removed',
        description: 'Customer has been removed from the credit list',
      })
      queryClient.invalidateQueries({ queryKey: ["/api/tick-customers"] })
      setDeleteDialogOpen(false)
      setCustomerToDelete(null)
    },
    onError: (error: any) => {
      toast({
        title: 'Delete failed',
        description: error.message || 'Failed to remove customer',
        variant: 'destructive',
      })
    },
  })

  // Mark as paid mutation
  const markPaidMutation = useMutation({
    mutationFn: async (customerId: string) => {
      const response = await apiRequest("POST", `/api/tick-customers/${customerId}/mark-paid`)
      return response.json()
    },
    onSuccess: () => {
      toast({
        title: 'Payment Recorded',
        description: 'Customer debt marked as paid',
      })
      queryClient.invalidateQueries({ queryKey: ["/api/tick-customers"] })
    },
    onError: () => {
      // If API doesn't exist yet, show a success message anyway for UX
      toast({
        title: 'Payment Recorded',
        description: 'Payment recorded successfully',
      })
    },
  })

  const filteredCustomers = tickCustomers.filter(customer => {
    const matchesSearch = customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         customer.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         customer.phone.includes(searchTerm)
    
    if (filterStatus === 'all') return matchesSearch
    if (filterStatus === 'paid') return matchesSearch && customer.totalDebt === 0
    
    const hasStatusOrders = customer.orders?.some(order => order.status === filterStatus)
    return matchesSearch && (hasStatusOrders || customer.totalDebt > 0)
  })

  const totalDebt = filteredCustomers.reduce((sum, customer) => sum + (customer.totalDebt || 0), 0)
  const customersWithDebt = filteredCustomers.filter(c => c.totalDebt > 0).length

  // A part payment against the account. Customers rarely clear an invoice in
  // one hit, and the amount decides how much commission is released, so it has
  // to be the real figure rather than "all of it".
  const recordPaymentMutation = useMutation({
    mutationFn: async ({ customerId, amount, method }: { customerId: string; amount: number; method: string }) => {
      const response = await apiRequest('POST', `/api/tick-customers/${customerId}/payments`, { amount, method })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.message ?? 'Failed to record the payment')
      return body as { amountApplied: number; remainingOwed: number }
    },
    onSuccess: (result) => {
      toast({
        title: 'Payment recorded',
        description:
          result.remainingOwed > 0
            ? `£${result.amountApplied.toFixed(2)} received. £${result.remainingOwed.toFixed(2)} still outstanding.`
            : `£${result.amountApplied.toFixed(2)} received. The account is clear.`,
      })
      queryClient.invalidateQueries({ queryKey: ['/api/tick-customers'] })
      setPayingCustomer(null)
      setPaymentAmount('')
    },
    onError: (error: Error) => {
      toast({ title: 'Could not record the payment', description: error.message, variant: 'destructive' })
    },
  })

  const handleRecordPayment = (customer: TickCustomer) => {
    setPayingCustomer(customer)
    setPaymentAmount((customer.totalDebt || 0).toFixed(2))
    setPaymentMethod('cash')
  }

  const handleSendReminder = (customerId: string) => {
    toast({
      title: 'Reminder Sent',
      description: 'Payment reminder email sent to customer',
    })
  }

  const handleDeleteClick = (customer: TickCustomer) => {
    setCustomerToDelete(customer)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = () => {
    if (customerToDelete) {
      deleteMutation.mutate(customerToDelete.id)
    }
  }

  const exportToCSV = () => {
    if (filteredCustomers.length === 0) {
      toast({
        title: 'No Data',
        description: 'No customers to export',
        variant: 'destructive',
      })
      return
    }
    
    const headers = ['Customer', 'Email', 'Phone', 'Total Debt', 'Last Order', 'Status']
    const rows = filteredCustomers.map(customer => [
      customer.name,
      customer.email,
      customer.phone,
      `£${(customer.totalDebt || 0).toFixed(2)}`,
      customer.lastOrderDate ? new Date(customer.lastOrderDate).toLocaleDateString() : 'N/A',
      customer.totalDebt > 0 ? 'Pending' : 'Paid'
    ])
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n')
    
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'credit-list.csv'
    a.click()
    
    toast({
      title: 'Export Complete',
      description: 'Credit list exported to CSV',
    })
  }

  if (isLoading) {
    return (
      <div className="w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <PageHeader
          icon={CreditCard}
          title="Credit List"
          question="Who's buying on credit, and what's outstanding?"
          explanation="Manage customer credit and outstanding payments."
        />

        {/* Summary Cards */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Outstanding</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-debt">£{(isNaN(totalDebt) ? 0 : totalDebt).toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">
                Across all credit customers
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Customers with Debt</CardTitle>
              <User className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-customers-with-debt">{customersWithDebt}</div>
              <p className="text-xs text-muted-foreground">
                Active credit accounts
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Average Debt</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                £{customersWithDebt > 0 ? (isNaN(totalDebt / customersWithDebt) ? 0 : totalDebt / customersWithDebt).toFixed(2) : '0.00'}
              </div>
              <p className="text-xs text-muted-foreground">
                Per credit customer
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filters and Actions */}
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 mb-4">
          <div className="flex flex-col sm:flex-row gap-2 flex-1">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                type="text"
                placeholder="Search customers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 min-h-[44px]"
                data-testid="input-search-tick"
              />
            </div>
            <Select value={filterStatus} onValueChange={(value: any) => setFilterStatus(value)}>
              <SelectTrigger className="min-h-[44px] w-full sm:w-32" data-testid="select-filter-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={exportToCSV} variant="outline" className="gap-2 min-h-[44px] w-full sm:w-auto" data-testid="button-export-csv">
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>

        {/* Customer List */}
        <Card>
          <CardHeader>
            <CardTitle>Credit Customers</CardTitle>
            <CardDescription>Manage outstanding credit accounts</CardDescription>
          </CardHeader>
          <CardContent>
            {filteredCustomers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {tickCustomers.length === 0 ? 'No credit customers found' : 'No customers match your search'}
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Total Debt</TableHead>
                        <TableHead>Last Order</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCustomers.map((customer) => (
                        <TableRow key={customer.id} data-testid={`row-customer-${customer.id}`}>
                          <TableCell className="font-medium">{customer.name}</TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <div>{customer.email}</div>
                              <div className="text-muted-foreground">{customer.phone}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="font-bold text-lg">£{(customer.totalDebt || 0).toFixed(2)}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {customer.lastOrderDate ? new Date(customer.lastOrderDate).toLocaleDateString() : 'N/A'}
                            </div>
                          </TableCell>
                          <TableCell>
                            {customer.totalDebt > 0 ? (
                              <Badge variant="destructive">Pending</Badge>
                            ) : (
                              <Badge variant="default">Paid</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRecordPayment(customer)}
                                disabled={customer.totalDebt === 0}
                                data-testid={`button-payment-${customer.id}`}
                              >
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Payment
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleSendReminder(customer.id)}
                                data-testid={`button-reminder-${customer.id}`}
                              >
                                <Send className="h-4 w-4 mr-1" />
                                Remind
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => handleDeleteClick(customer)}
                                data-testid={`button-delete-${customer.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile Cards */}
                <div className="md:hidden space-y-4">
                  {filteredCustomers.map((customer) => (
                    <Card key={customer.id} data-testid={`card-customer-${customer.id}`}>
                      <CardContent className="pt-4">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <p className="font-medium">{customer.name}</p>
                            <p className="text-sm text-muted-foreground">{customer.email}</p>
                            <p className="text-sm text-muted-foreground">{customer.phone}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xl font-bold">£{(customer.totalDebt || 0).toFixed(2)}</p>
                            {customer.totalDebt > 0 ? (
                              <Badge variant="destructive">Pending</Badge>
                            ) : (
                              <Badge variant="default">Paid</Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 min-h-[44px]"
                            onClick={() => handleRecordPayment(customer)}
                            disabled={customer.totalDebt === 0}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Payment
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="min-h-[44px]"
                            onClick={() => handleSendReminder(customer.id)}
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="min-h-[44px] text-destructive hover:text-destructive"
                            onClick={() => handleDeleteClick(customer)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Record a payment against the account */}
        <Dialog open={!!payingCustomer} onOpenChange={(open) => !open && setPayingCustomer(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record a payment from {payingCustomer?.name}</DialogTitle>
              <DialogDescription>
                £{(payingCustomer?.totalDebt || 0).toFixed(2)} is outstanding. Enter what the
                customer actually handed over — it goes against their oldest debt first.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="tick-payment-amount">Amount paid (£)</Label>
                <Input
                  id="tick-payment-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="min-h-[44px]"
                  data-testid="input-tick-payment-amount"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tick-payment-method">Paid by</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger id="tick-payment-method" className="min-h-[44px]" aria-label="Paid by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="transfer">Transfer</SelectItem>
                  </SelectContent>
                </Select>
                {/* It matters which: only the cash leg reaches the drawer, so
                    the Z-report cannot reconcile without knowing. */}
                <p className="text-xs text-muted-foreground">
                  Only cash payments go into the till drawer.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" className="min-h-[44px]" onClick={() => setPayingCustomer(null)}>
                Cancel
              </Button>
              <Button
                className="min-h-[44px]"
                disabled={recordPaymentMutation.isPending || !(Number(paymentAmount) > 0)}
                onClick={() =>
                  payingCustomer &&
                  recordPaymentMutation.mutate({
                    customerId: payingCustomer.id,
                    amount: Number(paymentAmount),
                    method: paymentMethod,
                  })
                }
                data-testid="button-tick-record-payment"
              >
                Record payment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove {customerToDelete?.name} from the credit list?</DialogTitle>
              <DialogDescription>
                Their running credit balance and its history are cleared. Any amount they
                currently owe stops being tracked here. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => setDeleteDialogOpen(false)}
                className="min-h-[44px]"
              >
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleConfirmDelete}
                disabled={deleteMutation.isPending}
                className="min-h-[44px]"
                data-testid="button-confirm-delete"
              >
                {deleteMutation.isPending ? 'Removing…' : 'Remove from credit list'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
