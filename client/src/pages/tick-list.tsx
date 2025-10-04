import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  Filter,
  Download,
  Send,
} from 'lucide-react'

interface TickCustomer {
  id: string
  name: string
  email: string
  phone: string
  totalDebt: number
  lastOrderDate: string
  orders: Array<{
    id: string
    date: string
    amount: number
    status: 'pending' | 'partial' | 'paid'
    items: string[]
  }>
}

export default function TickList() {
  const { toast } = useToast()
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'partial' | 'paid'>('all')

  // Mock data - would come from API
  const tickCustomers: TickCustomer[] = [
    {
      id: '1',
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+1 234 567 8900',
      totalDebt: 250.00,
      lastOrderDate: '2024-01-15',
      orders: [
        {
          id: 'ORD-001',
          date: '2024-01-15',
          amount: 150.00,
          status: 'pending',
          items: ['Widget A x2', 'Gadget B x1']
        },
        {
          id: 'ORD-002',
          date: '2024-01-10',
          amount: 100.00,
          status: 'pending',
          items: ['Service C x1']
        }
      ]
    },
    {
      id: '2',
      name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+1 234 567 8901',
      totalDebt: 75.00,
      lastOrderDate: '2024-01-14',
      orders: [
        {
          id: 'ORD-003',
          date: '2024-01-14',
          amount: 75.00,
          status: 'partial',
          items: ['Product D x3']
        }
      ]
    },
    {
      id: '3',
      name: 'Bob Wilson',
      email: 'bob@example.com',
      phone: '+1 234 567 8902',
      totalDebt: 500.00,
      lastOrderDate: '2024-01-12',
      orders: [
        {
          id: 'ORD-004',
          date: '2024-01-12',
          amount: 300.00,
          status: 'pending',
          items: ['Premium Service x1']
        },
        {
          id: 'ORD-005',
          date: '2024-01-08',
          amount: 200.00,
          status: 'pending',
          items: ['Widget E x5', 'Gadget F x2']
        }
      ]
    }
  ]

  const filteredCustomers = tickCustomers.filter(customer => {
    const matchesSearch = customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         customer.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         customer.phone.includes(searchTerm)
    
    if (filterStatus === 'all') return matchesSearch
    
    const hasStatusOrders = customer.orders.some(order => order.status === filterStatus)
    return matchesSearch && hasStatusOrders
  })

  const totalDebt = filteredCustomers.reduce((sum, customer) => sum + customer.totalDebt, 0)
  const customersWithDebt = filteredCustomers.filter(c => c.totalDebt > 0).length

  const handleRecordPayment = (customerId: string, amount: number) => {
    toast({
      title: 'Payment Recorded',
      description: `Payment of £${amount.toFixed(2)} recorded successfully`,
    })
  }

  const handleSendReminder = (customerId: string) => {
    toast({
      title: 'Reminder Sent',
      description: 'Payment reminder email sent to customer',
    })
  }

  const exportToCSV = () => {
    // Convert data to CSV
    const headers = ['Customer', 'Email', 'Phone', 'Total Debt', 'Last Order', 'Status']
    const rows = filteredCustomers.map(customer => [
      customer.name,
      customer.email,
      customer.phone,
      `£${customer.totalDebt.toFixed(2)}`,
      customer.lastOrderDate,
      customer.orders.some(o => o.status === 'pending') ? 'Pending' : 'Partial'
    ])
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n')
    
    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'tick-list.csv'
    a.click()
    
    toast({
      title: 'Export Complete',
      description: 'Tick list exported to CSV',
    })
  }

  const getStatusBadge = (status: string) => {
    const variants = {
      pending: 'destructive',
      partial: 'secondary',
      paid: 'default'
    } as const
    
    return <Badge variant={variants[status as keyof typeof variants]}>{status}</Badge>
  }

  return (
    <div className="w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground flex items-center gap-2">
            <CreditCard className="h-6 sm:h-8 w-6 sm:w-8" />
            Tick List (Credit Customers)
          </h1>
          <p className="text-muted-foreground mt-1">Manage customer credit and outstanding payments</p>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Outstanding</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">£{totalDebt.toFixed(2)}</div>
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
              <div className="text-2xl font-bold">{customersWithDebt}</div>
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
                £{customersWithDebt > 0 ? (totalDebt / customersWithDebt).toFixed(2) : '0.00'}
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
              <SelectTrigger className="min-h-[44px] w-full sm:w-32">
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
            <CardDescription>Click on a customer to view detailed order history</CardDescription>
          </CardHeader>
          <CardContent>
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
                  <TableRow key={customer.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div>{customer.email}</div>
                        <div className="text-muted-foreground">{customer.phone}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-bold text-lg">£{customer.totalDebt.toFixed(2)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(customer.lastOrderDate).toLocaleDateString()}
                      </div>
                    </TableCell>
                    <TableCell>
                      {customer.orders.some(o => o.status === 'pending') ? (
                        <Badge variant="destructive">Pending</Badge>
                      ) : customer.orders.some(o => o.status === 'partial') ? (
                        <Badge variant="secondary">Partial</Badge>
                      ) : (
                        <Badge variant="default">Paid</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRecordPayment(customer.id, customer.totalDebt)}
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
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filteredCustomers.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No credit customers found
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}