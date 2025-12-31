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
  RefreshCw,
  ExternalLink,
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

  // Fetch invoices from API
  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ['/api/invoices'],
  })

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

  const [regenerating, setRegenerating] = useState(false)

  const regenerateAllMissing = async () => {
    setRegenerating(true)
    try {
      const response = await apiRequest('POST', '/api/invoices/regenerate-all-missing')
      const data = await response.json()
      
      toast({
        title: 'PDFs Generated',
        description: data.message,
      })
      
      queryClient.invalidateQueries({ queryKey: ['/api/invoices'] })
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to regenerate PDFs',
        variant: 'destructive',
      })
    } finally {
      setRegenerating(false)
    }
  }

  const viewInvoicePdf = async (invoiceId: string, invoiceNumber: string) => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf`, {
        credentials: 'include',
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.pdfUrl) {
          window.open(data.pdfUrl, '_blank')
        } else {
          toast({
            title: 'PDF Not Available',
            description: 'This invoice PDF has not been generated yet. Click "Generate Missing PDFs" to create it.',
            variant: 'destructive',
          })
        }
      } else {
        toast({
          title: 'Error',
          description: 'Could not retrieve invoice PDF',
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to get invoice PDF',
        variant: 'destructive',
      })
    }
  }

  const printInvoice = async (invoiceId: string, invoiceNumber: string) => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf`, {
        credentials: 'include',
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.pdfUrl) {
          const printWindow = window.open(data.pdfUrl, '_blank')
          if (printWindow) {
            printWindow.onload = () => {
              printWindow.print()
            }
          }
          toast({
            title: 'Print',
            description: 'Opening PDF for printing...',
          })
        } else {
          toast({
            title: 'PDF Not Available',
            description: 'Generate the PDF first before printing',
            variant: 'destructive',
          })
        }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to print invoice',
        variant: 'destructive',
      })
    }
  }

  const emailInvoice = async (invoiceId: string, customerEmail: string, invoiceNumber: string) => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf`, {
        credentials: 'include',
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.pdfUrl) {
          const subject = encodeURIComponent(`Invoice ${invoiceNumber} from Viger Assist Ltd`)
          const body = encodeURIComponent(`Dear Customer,\n\nPlease find your invoice attached:\n${data.pdfUrl}\n\nThank you for your business.\n\nBest regards,\nViger Assist Ltd`)
          window.open(`mailto:${customerEmail}?subject=${subject}&body=${body}`, '_blank')
          toast({
            title: 'Email Client Opened',
            description: `Composing email to ${customerEmail}`,
          })
        } else {
          toast({
            title: 'PDF Not Available',
            description: 'Generate the PDF first before emailing',
            variant: 'destructive',
          })
        }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to prepare email',
        variant: 'destructive',
      })
    }
  }

  const copyInvoiceLink = async (invoiceId: string, invoiceNumber: string) => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf`, {
        credentials: 'include',
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.pdfUrl) {
          await navigator.clipboard.writeText(data.pdfUrl)
          toast({
            title: 'Link Copied',
            description: 'Invoice PDF link copied to clipboard',
          })
        } else {
          toast({
            title: 'No Link Available',
            description: 'PDF has not been generated yet',
            variant: 'destructive',
          })
        }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to copy link',
        variant: 'destructive',
      })
    }
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
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground flex items-center gap-2">
            <FileText className="h-6 sm:h-8 w-6 sm:w-8" />
            Invoice Management
          </h1>
          <p className="text-muted-foreground mt-1">View, download, and manage all invoices</p>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">£{(isNaN(totalRevenue) ? 0 : totalRevenue).toFixed(2)}</div>
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
              <div className="text-2xl font-bold">£{(isNaN(pendingRevenue) ? 0 : pendingRevenue).toFixed(2)}</div>
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
              <div className="text-2xl font-bold text-destructive">£{(isNaN(overdueRevenue) ? 0 : overdueRevenue).toFixed(2)}</div>
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
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 mb-4">
          <div className="flex flex-col sm:flex-row gap-2 flex-1">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                type="text"
                placeholder="Search invoices..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 min-h-[44px]"
                data-testid="input-search-invoices"
              />
            </div>
            <Select value={filterStatus} onValueChange={(value: any) => setFilterStatus(value)}>
              <SelectTrigger className="min-h-[44px] w-full sm:w-32">
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
              <SelectTrigger className="min-h-[44px] w-full sm:w-32">
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
          <div className="flex gap-2 w-full sm:w-auto">
            <Button 
              variant="outline" 
              className="gap-2 min-h-[44px] flex-1 sm:flex-none" 
              onClick={regenerateAllMissing}
              disabled={regenerating}
              data-testid="button-regenerate-pdfs"
            >
              <RefreshCw className={`h-4 w-4 ${regenerating ? 'animate-spin' : ''}`} />
              {regenerating ? 'Generating...' : 'Generate Missing PDFs'}
            </Button>
            <Button className="gap-2 min-h-[44px] flex-1 sm:flex-none" data-testid="button-create-invoice">
              <FileText className="h-4 w-4" />
              Create Invoice
            </Button>
          </div>
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
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      Loading invoices...
                    </TableCell>
                  </TableRow>
                ) : filteredInvoices.map((invoice) => (
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
                          onClick={() => viewInvoicePdf(invoice.id, invoice.invoiceNumber)}
                          title="View PDF"
                          data-testid={`button-view-${invoice.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => printInvoice(invoice.id, invoice.invoiceNumber)}
                          title="Print Invoice"
                          data-testid={`button-print-${invoice.id}`}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyInvoiceLink(invoice.id, invoice.invoiceNumber)}
                          title="Copy PDF Link"
                          data-testid={`button-link-${invoice.id}`}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => emailInvoice(invoice.id, invoice.customerEmail, invoice.invoiceNumber)}
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