import { useState } from "react";
import { apiFetch } from "@/lib/appPaths";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subDays } from "date-fns";
import { 
  Download, 
  FileText, 
  Calendar as CalendarIcon, 
  TrendingUp, 
  Users, 
  Package, 
  DollarSign,
  ShoppingCart,
  Home,
  BarChart3,
  PieChart,
  FileSpreadsheet
} from "lucide-react";
import { Link } from "wouter";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart as RePieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ReportsPageSkeleton } from "@/components/reporting-skeletons";

interface ReportData {
  revenue: {
    total: number;
    byDay: Array<{ date: string; revenue: number; orders: number }>;
    byCategory: Array<{ category: string; revenue: number; percentage: number }>;
    byPaymentMethod: Array<{ method: string; count: number; revenue: number }>;
  };
  orders: {
    total: number;
    average: number;
    topProducts: Array<{ name: string; quantity: number; revenue: number }>;
    hourlyDistribution: Array<{ hour: number; count: number }>;
  };
  customers: {
    total: number;
    new: number;
    returning: number;
    topCustomers: Array<{ name: string; orders: number; revenue: number; loyalty: number }>;
    rfmSegments: Array<{ segment: string; count: number; avgRevenue: number }>;
  };
  inventory: {
    totalValue: number;
    lowStock: number;
    outOfStock: number;
    turnoverRate: number;
    topMoving: Array<{ product: string; sold: number; remaining: number }>;
  };
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export default function Reports() {
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState<{
    from: Date;
    to: Date;
  }>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  const [presetRange, setPresetRange] = useState("month");
  const [exportFormat, setExportFormat] = useState<"csv" | "pdf">("csv");
  const [isExporting, setIsExporting] = useState(false);

  // Fetch report data
  const { data: reportData, isLoading, refetch } = useQuery<ReportData>({
    queryKey: ["/api/reports", dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        from: dateRange.from.toISOString(),
        to: dateRange.to.toISOString(),
      });
      const response = await apiFetch(`/api/reports?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch report data");
      return response.json();
    },
  });

  // Handle preset date ranges
  const handlePresetRange = (preset: string) => {
    const today = new Date();
    let from: Date, to: Date;

    switch (preset) {
      case "today":
        from = new Date(today.setHours(0, 0, 0, 0));
        to = new Date(today.setHours(23, 59, 59, 999));
        break;
      case "week":
        from = startOfWeek(today);
        to = endOfWeek(today);
        break;
      case "month":
        from = startOfMonth(today);
        to = endOfMonth(today);
        break;
      case "last30":
        from = subDays(today, 30);
        to = today;
        break;
      case "quarter":
        const quarter = Math.floor(today.getMonth() / 3);
        from = new Date(today.getFullYear(), quarter * 3, 1);
        to = new Date(today.getFullYear(), quarter * 3 + 3, 0);
        break;
      case "year":
        from = new Date(today.getFullYear(), 0, 1);
        to = new Date(today.getFullYear(), 11, 31);
        break;
      default:
        return;
    }

    setPresetRange(preset);
    setDateRange({ from, to });
  };

  // Export report
  const handleExport = async (type: "revenue" | "orders" | "customers" | "inventory" | "full") => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams({
        from: dateRange.from.toISOString(),
        to: dateRange.to.toISOString(),
        format: exportFormat,
        type,
      });

      const response = await apiRequest("GET", `/api/reports/export?${params}`);
      
      if (exportFormat === "csv") {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${type}_report_${format(dateRange.from, "yyyy-MM-dd")}_${format(dateRange.to, "yyyy-MM-dd")}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      } else {
        // PDF export
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${type}_report_${format(dateRange.from, "yyyy-MM-dd")}_${format(dateRange.to, "yyyy-MM-dd")}.pdf`;
        a.click();
        window.URL.revokeObjectURL(url);
      }

      toast({
        title: "Report Exported",
        description: `${type} report has been downloaded as ${exportFormat.toUpperCase()}`,
      });
    } catch (error: any) {
      toast({
        title: "Export Failed",
        description: error.message || "Failed to export report",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary border-b border-slate-700 sticky top-0 z-50 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-10 h-10 bg-accent rounded-lg">
                <BarChart3 className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white">Advanced Reports</h1>
                <p className="text-xs sm:text-sm text-slate-400">Analytics & Insights</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" className="text-white min-h-[44px]" data-testid="link-home">
                <Link href="/">
                  <Home className="h-4 w-4 sm:mr-2" />
                  <span className="sr-only sm:not-sr-only">Dashboard</span>
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading && !reportData ? (
          <ReportsPageSkeleton />
        ) : (
        <>
        {/* Date Range Controls */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Report Period</CardTitle>
            <CardDescription>Select date range for your reports</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Preset Ranges */}
              <div className="flex-1">
                <Select value={presetRange} onValueChange={handlePresetRange}>
                  <SelectTrigger className="min-h-[44px]" data-testid="select-preset-range">
                    <SelectValue placeholder="Select preset range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="week">This Week</SelectItem>
                    <SelectItem value="month">This Month</SelectItem>
                    <SelectItem value="last30">Last 30 Days</SelectItem>
                    <SelectItem value="quarter">This Quarter</SelectItem>
                    <SelectItem value="year">This Year</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Custom Date Range */}
              <div className="flex gap-2 flex-1">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start min-h-[44px]" data-testid="button-date-from">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      <span className="truncate">{format(dateRange.from, "PP")}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={dateRange.from}
                      onSelect={(date) => date && setDateRange(prev => ({ ...prev, from: date }))}
                    />
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start min-h-[44px]" data-testid="button-date-to">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      <span className="truncate">{format(dateRange.to, "PP")}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={dateRange.to}
                      onSelect={(date) => date && setDateRange(prev => ({ ...prev, to: date }))}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Export Options */}
              <div className="flex gap-2 flex-wrap lg:flex-nowrap">
                <Select value={exportFormat} onValueChange={(value: "csv" | "pdf") => setExportFormat(value)}>
                  <SelectTrigger className="w-full lg:w-32 min-h-[44px]" data-testid="select-export-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">CSV</SelectItem>
                    <SelectItem value="pdf">PDF</SelectItem>
                  </SelectContent>
                </Select>
                <Button 
                  onClick={() => handleExport("full")} 
                  disabled={isExporting || isLoading}
                  className="min-h-[44px] w-full lg:w-auto"
                  data-testid="button-export-full"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export All
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <p className="text-2xl font-bold">
                  ${(typeof reportData?.revenue?.total === 'number' ? reportData.revenue.total : parseFloat(reportData?.revenue?.total || '0')).toFixed(2)}
                </p>
                <DollarSign className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Orders</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <p className="text-2xl font-bold">{reportData?.orders.total || 0}</p>
                <ShoppingCart className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Customers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <p className="text-2xl font-bold">{reportData?.customers.total || 0}</p>
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Order Value</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <p className="text-2xl font-bold">
                  ${(typeof reportData?.orders?.average === 'number' ? reportData.orders.average : parseFloat(reportData?.orders?.average || '0')).toFixed(2)}
                </p>
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detailed Reports Tabs */}
        <Tabs defaultValue="revenue" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4">
            <TabsTrigger value="revenue" className="min-h-[44px]">Revenue</TabsTrigger>
            <TabsTrigger value="orders" className="min-h-[44px]">Orders</TabsTrigger>
            <TabsTrigger value="customers" className="min-h-[44px]">Customers</TabsTrigger>
            <TabsTrigger value="inventory" className="min-h-[44px]">Inventory</TabsTrigger>
          </TabsList>

          {/* Revenue Tab */}
          <TabsContent value="revenue" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Revenue Analysis</CardTitle>
                    <CardDescription>Daily revenue and order trends</CardDescription>
                  </div>
                  <Button 
                    size="sm" 
                    onClick={() => handleExport("revenue")}
                    disabled={isExporting}
                    className="min-h-[44px]"
                    data-testid="button-export-revenue"
                  >
                    <Download className="mr-2 h-3 w-3" />
                    Export
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={reportData?.revenue.byDay || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#3B82F6" name="Revenue ($)" />
                    <Line yAxisId="right" type="monotone" dataKey="orders" stroke="#10B981" name="Orders" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Revenue by Category</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <RePieChart>
                      <Pie
                        data={reportData?.revenue.byCategory || []}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="revenue"
                        label
                      >
                        {reportData?.revenue.byCategory.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </RePieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Payment Methods</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Method</TableHead>
                          <TableHead>Orders</TableHead>
                          <TableHead>Revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reportData?.revenue.byPaymentMethod?.map((method) => (
                          <TableRow key={method.method} data-testid={`payment-method-${method.method}`}>
                            <TableCell>{method.method}</TableCell>
                            <TableCell>{method.count}</TableCell>
                            <TableCell>${(typeof method.revenue === 'number' ? method.revenue : parseFloat(method.revenue || '0')).toFixed(2)}</TableCell>
                          </TableRow>
                        )) || (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center">No data</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Orders Tab */}
          <TabsContent value="orders" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Order Analysis</CardTitle>
                    <CardDescription>Order patterns and top products</CardDescription>
                  </div>
                  <Button 
                    size="sm" 
                    onClick={() => handleExport("orders")}
                    disabled={isExporting}
                    className="min-h-[44px]"
                    data-testid="button-export-orders"
                  >
                    <Download className="mr-2 h-3 w-3" />
                    Export
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-medium mb-4">Hourly Distribution</h4>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={reportData?.orders.hourlyDistribution || []}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="hour" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="count" fill="#3B82F6" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium mb-4">Top Products</h4>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead>Quantity</TableHead>
                            <TableHead>Revenue</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reportData?.orders.topProducts?.slice(0, 5).map((product) => (
                            <TableRow key={product.name} data-testid={`top-product-${product.name}`}>
                              <TableCell className="font-medium">{product.name}</TableCell>
                              <TableCell>{product.quantity}</TableCell>
                              <TableCell>${(typeof product.revenue === 'number' ? product.revenue : parseFloat(product.revenue || '0')).toFixed(2)}</TableCell>
                            </TableRow>
                          )) || (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center">No data</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Customers Tab */}
          <TabsContent value="customers" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Customer Analysis</CardTitle>
                    <CardDescription>Customer segments and top performers</CardDescription>
                  </div>
                  <Button 
                    size="sm" 
                    onClick={() => handleExport("customers")}
                    disabled={isExporting}
                    className="min-h-[44px]"
                    data-testid="button-export-customers"
                  >
                    <Download className="mr-2 h-3 w-3" />
                    Export
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">New Customers</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">{reportData?.customers.new || 0}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Returning Customers</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">{reportData?.customers.returning || 0}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Retention Rate</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">
                        {reportData?.customers.total 
                          ? ((reportData.customers.returning / reportData.customers.total) * 100).toFixed(1)
                          : "0"}%
                      </p>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-medium mb-4">Top Customers</h4>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Customer</TableHead>
                            <TableHead>Orders</TableHead>
                            <TableHead>Revenue</TableHead>
                            <TableHead>Points</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reportData?.customers.topCustomers?.slice(0, 5).map((customer) => (
                            <TableRow key={customer.name} data-testid={`top-customer-${customer.name}`}>
                              <TableCell className="font-medium">{customer.name}</TableCell>
                              <TableCell>{customer.orders}</TableCell>
                              <TableCell>${(typeof customer.revenue === 'number' ? customer.revenue : parseFloat(customer.revenue || '0')).toFixed(2)}</TableCell>
                              <TableCell>{customer.loyalty}</TableCell>
                            </TableRow>
                          )) || (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center">No data</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium mb-4">RFM Segments</h4>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Segment</TableHead>
                            <TableHead>Count</TableHead>
                            <TableHead>Avg Revenue</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reportData?.customers.rfmSegments?.map((segment) => (
                            <TableRow key={segment.segment} data-testid={`rfm-segment-${segment.segment}`}>
                              <TableCell className="font-medium">{segment.segment}</TableCell>
                              <TableCell>{segment.count}</TableCell>
                              <TableCell>${(typeof segment.avgRevenue === 'number' ? segment.avgRevenue : parseFloat(segment.avgRevenue || '0')).toFixed(2)}</TableCell>
                            </TableRow>
                          )) || (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center">No data</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Inventory Tab */}
          <TabsContent value="inventory" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Inventory Analysis</CardTitle>
                    <CardDescription>Stock levels and product movement</CardDescription>
                  </div>
                  <Button 
                    size="sm" 
                    onClick={() => handleExport("inventory")}
                    disabled={isExporting}
                    className="min-h-[44px]"
                    data-testid="button-export-inventory"
                  >
                    <Download className="mr-2 h-3 w-3" />
                    Export
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Stock Value</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">
                        ${(typeof reportData?.inventory?.totalValue === 'number' ? reportData.inventory.totalValue : parseFloat(reportData?.inventory?.totalValue || '0')).toFixed(2)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Low Stock Items</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold text-orange-600">
                        {reportData?.inventory.lowStock || 0}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Out of Stock</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold text-red-600">
                        {reportData?.inventory.outOfStock || 0}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Turnover Rate</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">
                        {reportData?.inventory.turnoverRate?.toFixed(1) || "0.0"}x
                      </p>
                    </CardContent>
                  </Card>
                </div>

                <div>
                  <h4 className="text-sm font-medium mb-4">Top Moving Products</h4>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>Sold</TableHead>
                          <TableHead>Remaining</TableHead>
                          <TableHead>Movement Rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reportData?.inventory.topMoving?.slice(0, 10).map((product) => (
                          <TableRow key={product.product} data-testid={`top-moving-${product.product}`}>
                            <TableCell className="font-medium">{product.product}</TableCell>
                            <TableCell>{product.sold}</TableCell>
                            <TableCell>{product.remaining}</TableCell>
                            <TableCell>
                              {((product.sold / (product.sold + product.remaining)) * 100).toFixed(1)}%
                            </TableCell>
                          </TableRow>
                        )) || (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center">No data</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        </>
        )}
      </main>
    </div>
  );
}