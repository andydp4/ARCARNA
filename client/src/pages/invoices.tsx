import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { apiRequest, queryClient } from '@/lib/queryClient'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import {
  FileText,
  Download,
  Send,
  Search,
  Calendar,
  DollarSign,
  User,
  Eye,
  Printer,
  Mail,
  Copy,
  CheckCircle,
  Clock,
  AlertCircle,
} from 'lucide-react'

interface Invoice {
  id: string
  invoiceNumber: string
  orderId: string
  customerId: string
  customerName: string
  customerEmail: string
  date: string
  dueDate: string
  total: number
  subtotal: number
  vat: number
  status: 'paid' | 'pending' | 'overdue' | 'cancelled'
  paymentMethod: string
  items: Array<{
    name: string
    quantity: number
    unitPrice: number
    total: number
  }>
}

export default function Invoices() {
  const { toast } = useToast()
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'pending' | 'overdue'>('all')
  const [selectedPeriod, setSelectedPeriod] = useState<'all' | 'today' | 'week' | 'month'>('month')

  // Mock invoice data - would come from API
  const invoices: Invoice[] = [
    {
      id: '1',
      invoiceNumber: 'INV-2024-001',
      orderId: 'ORD-001',
      customerId: 'CUST-001',
      customerName: 'John Doe',
      customerEmail: 'john@example.com',
      date: '2024-01-15',
      dueDate: '2024-02-15',
      total: 250.00,
      subtotal: 208.33,
      vat: 41.67,
      status: 'paid',
      paymentMethod: 'card',
      items: [
        { name: 'Product A', quantity: 2, unitPrice: 75.00, total: 150.00 },
        { name: 'Product B', quantity: 1, unitPrice: 100.00, total: 100.00 },
      ]
    },
    {
      id: '2',
      invoiceNumber: 'INV-2024-002',
      orderId: 'ORD-002',
      customerId: 'CUST-002',
      customerName: 'Jane Smith',
      customerEmail: 'jane@example.com',
      date: '2024-01-14',
      dueDate: '2024-02-14',
      total: 175.50,
      subtotal: 146.25,
      vat: 29.25,
      status: 'pending',
      paymentMethod: 'tick',
      items: [
        { name: 'Service C', quantity: 1, unitPrice: 175.50, total: 175.50 },
      ]
    },
    {
      id: '3',
      invoiceNumber: 'INV-2024-003',
      orderId: 'ORD-003',
      customerId: 'CUST-003',
      customerName: 'Bob Wilson',
      customerEmail: 'bob@example.com',
      date: '2024-01-10',
      dueDate: '2024-02-10',
      total: 500.00,
      subtotal: 416.67,
      vat: 83.33,
      status: 'overdue',
      paymentMethod: 'transfer',
      items: [
        { name: 'Premium Service', quantity: 1, unitPrice: 500.00, total: 500.00 },
      ]
    }
  ]

  const filteredInvoices = invoices.filter(invoice => {
    const matchesSearch = 
      invoice.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      invoice.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      invoice.customerEmail.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesStatus = filterStatus === 'all' || invoice.status === filterStatus
    
    return matchesSearch && matchesStatus
  })

  const totalRevenue = filteredInvoices.reduce((sum, inv) => sum + (inv.status === 'paid' ? inv.total : 0), 0)
  const pendingRevenue = filteredInvoices.reduce((sum, inv) => sum + (inv.status === 'pending' ? inv.total : 0), 0)
  const overdueRevenue = filteredInvoices.reduce((sum, inv) => sum + (inv.status === 'overdue' ? inv.total : 0), 0)

  const getStatusBadge = (status: string) => {
    const variants = {
      paid: { color: 'default', icon: CheckCircle },
      pending: { color: 'secondary', icon: Clock },
      overdue: { color: 'destructive', icon: AlertCircle },
      cancelled: { color: 'outline', icon: AlertCircle },
    } as const
    
    const variant = variants[status as keyof typeof variants]
    const Icon = variant.icon
    
    return (
      <Badge variant={variant.color as any} className="gap-1">
        <Icon className="h-3 w-3" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  const downloadInvoice = async (invoiceId: string, invoiceNumber: string) => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf`, {
        credentials: 'include',
      })
      
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${invoiceNumber}.pdf`
        a.click()
        window.URL.revokeObjectURL(url)
        
        toast({
          title: 'Success',
          description: 'Invoice downloaded successfully',
        })
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to download invoice',
        variant: 'destructive',
      })
    }
  }

  const sendInvoice = (invoiceId: string, customerEmail: string) => {
    toast({
      title: 'Invoice Sent',
      description: `Invoice emailed to ${customerEmail}`,
    })
  }

  const copyInvoiceNumber = (invoiceNumber: string) => {
    navigator.clipboard.writeText(invoiceNumber)
    toast({
      title: 'Copied',
      description: 'Invoice number copied to clipboard',
    })
  }

  return (
    <div className="w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <FileText className="h-8 w-8" />
            Invoice Management
          </h1>
          <p className="text-muted-foreground mt-1">View, download, and manage all invoices</p>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">£{totalRevenue.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">
                Paid invoices
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">£{pendingRevenue.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">
                Awaiting payment
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Overdue</CardTitle>
              <AlertCircle className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">£{overdueRevenue.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">
                Past due date
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Invoices</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{filteredInvoices.length}</div>
              <p className="text-xs text-muted-foreground">
                This period
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex justify-between items-center mb-4">
          <div className="flex gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                type="text"
                placeholder="Search invoices..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
                data-testid="input-search-invoices"
              />
            </div>
            <Select value={filterStatus} onValueChange={(value: any) => setFilterStatus(value)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedPeriod} onValueChange={(value: any) => setSelectedPeriod(value)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="gap-2" data-testid="button-create-invoice">
            <FileText className="h-4 w-4" />
            Create Invoice
          </Button>
        </div>

        {/* Invoices Table */}
        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>Manage and track all customer invoices</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {invoice.invoiceNumber}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => copyInvoiceNumber(invoice.invoiceNumber)}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div className="font-medium">{invoice.customerName}</div>
                        <div className="text-muted-foreground">{invoice.customerEmail}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(invoice.date).toLocaleDateString()}
                      </div>
                    </TableCell>
                    <TableCell>
                      {new Date(invoice.dueDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <span className="font-bold">£{invoice.total.toFixed(2)}</span>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(invoice.status)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{invoice.paymentMethod}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => downloadInvoice(invoice.id, invoice.invoiceNumber)}
                          title="Download PDF"
                          data-testid={`button-download-${invoice.id}`}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="View Invoice"
                          data-testid={`button-view-${invoice.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Print Invoice"
                          data-testid={`button-print-${invoice.id}`}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => sendInvoice(invoice.id, invoice.customerEmail)}
                          title="Email Invoice"
                          data-testid={`button-email-${invoice.id}`}
                        >
                          <Mail className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filteredInvoices.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No invoices found
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}