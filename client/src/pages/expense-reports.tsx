import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package,
  Receipt,
  Download,
  PieChart,
  Activity,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  LineChart, Line, BarChart, Bar, PieChart as RechartsPI, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#64748B'];

export function ExpenseReportsPage() {
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState("thisMonth");
  
  // Calculate date ranges
  const getDateRange = () => {
    const now = new Date();
    let startDate, endDate;
    
    switch (dateRange) {
      case "today":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        break;
      case "thisWeek":
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);
        endDate = new Date(weekStart);
        endDate.setDate(weekStart.getDate() + 6);
        endDate.setHours(23, 59, 59);
        startDate = weekStart;
        break;
      case "thisMonth":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        break;
      case "lastMonth":
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        break;
      case "thisYear":
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    }
    
    return { startDate, endDate };
  };
  
  const { startDate, endDate } = getDateRange();
  
  // Fetch expense report
  const { data: expenseReport, isLoading: expenseLoading } = useQuery({
    queryKey: ["/api/expense-report", startDate.toISOString(), endDate.toISOString()],
    queryFn: () => apiRequest("GET", `/api/expense-report?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`, null) as Promise<any>,
  });
  
  // Fetch profit analysis
  const { data: profitAnalysis, isLoading: profitLoading } = useQuery({
    queryKey: ["/api/profit-analysis", startDate.toISOString(), endDate.toISOString()],
    queryFn: () => apiRequest("GET", `/api/profit-analysis?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`, null) as Promise<any>,
  });
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };
  
  const formatPercent = (value: number) => {
    return `${value.toFixed(2)}%`;
  };
  
  const exportToCSV = (data: any[], filename: string) => {
    if (!data?.length) {
      toast({
        title: "Nothing to export",
        description: "There are no rows for this report in the selected period.",
        variant: "destructive",
      });
      return;
    }
    const csvContent =
      "data:text/csv;charset=utf-8," +
      Object.keys(data[0]).join(",") +
      "\n" +
      data.map((e: any) => Object.values(e).join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${filename}_${format(new Date(), "yyyy-MM-dd")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({
      title: "Download started",
      description: "Your CSV file should begin downloading shortly.",
    });
  };
  
  const isLoading = expenseLoading || profitLoading;
  const hasError = !isLoading && (!expenseReport || !profitAnalysis);
  
  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading reports...</p>
        </div>
      </div>
    );
  }
  
  if (hasError) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <p className="text-destructive font-semibold mb-2">Failed to load reports</p>
          <p className="text-muted-foreground">Please try refreshing the page</p>
          <Button onClick={() => window.location.reload()} className="mt-4">
            Refresh Page
          </Button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Financial reports</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            Overhead is fixed or recurring cost. Order expenses are charges tied to specific orders. Profit ties both back to revenue for the same period.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:gap-3">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="min-h-[44px] w-full sm:w-[200px]" data-testid="select-date-range">
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="thisWeek">This Week</SelectItem>
              <SelectItem value="thisMonth">This Month</SelectItem>
              <SelectItem value="lastMonth">Last Month</SelectItem>
              <SelectItem value="thisYear">This Year</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            className="min-h-[44px] w-full sm:w-auto"
            onClick={() => exportToCSV(profitAnalysis?.dailyTrends || [], "profit_trends")}
            data-testid="button-export"
          >
            <Download className="mr-2 h-4 w-4" />
            Export profit trends (CSV)
          </Button>
        </div>
      </div>

      {/* Period Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Active period</CardTitle>
          <CardDescription>Every tab below uses these dates.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm tabular-nums text-muted-foreground">
            {format(startDate, "MMMM d, yyyy")} — {format(endDate, "MMMM d, yyyy")}{" "}
            <span className="text-foreground">({expenseReport?.period?.days ?? 0} days)</span>
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="profit" className="space-y-6">
        <TabsList className="grid h-auto w-full grid-cols-1 gap-1 p-1 sm:grid-cols-3">
          <TabsTrigger value="profit" className="min-h-[44px] gap-2">
            <TrendingUp className="h-4 w-4 shrink-0" />
            Profit analysis
          </TabsTrigger>
          <TabsTrigger value="expenses" className="min-h-[44px] gap-2">
            <Receipt className="h-4 w-4 shrink-0" />
            Expense report
          </TabsTrigger>
          <TabsTrigger value="margins" className="min-h-[44px] gap-2">
            <PieChart className="h-4 w-4 shrink-0" />
            Margins
          </TabsTrigger>
        </TabsList>
        
        {/* Profit Analysis Tab */}
        <TabsContent value="profit" className="space-y-6">
          <Card className="border-primary/20 bg-muted/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Bottom line</CardTitle>
              <CardDescription>Net profit after revenue, COGS, and all expenses in this period</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div
                className={`text-3xl font-bold tabular-nums tracking-tight sm:text-4xl ${
                  profitAnalysis?.summary?.netProfit >= 0 ? "text-emerald-600" : "text-red-600"
                }`}
                data-testid="text-net-profit"
              >
                {formatCurrency(profitAnalysis?.summary?.netProfit || 0)}
              </div>
              <p className="text-sm text-muted-foreground">
                Net margin {formatPercent(profitAnalysis?.summary?.netMargin || 0)}
              </p>
            </CardContent>
          </Card>

          {/* Key Metrics */}
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Revenue through operating profit
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums tracking-tight" data-testid="text-revenue">
                  {formatCurrency(profitAnalysis?.summary?.revenue || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {profitAnalysis?.summary?.orderCount || 0} orders in period
                </p>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Gross profit</CardTitle>
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums tracking-tight text-green-600" data-testid="text-gross-profit">
                  {formatCurrency(profitAnalysis?.summary?.grossProfit || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatPercent(profitAnalysis?.summary?.grossMargin || 0)} gross margin
                </p>
              </CardContent>
            </Card>

            <Card className="shadow-sm sm:col-span-2 lg:col-span-1">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Operating profit</CardTitle>
                <Activity className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums tracking-tight text-blue-600" data-testid="text-operating-profit">
                  {formatCurrency(profitAnalysis?.summary?.operatingProfit || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatPercent(profitAnalysis?.summary?.operatingMargin || 0)} operating margin
                </p>
              </CardContent>
            </Card>
            </div>
          </div>

          <Separator />

          {/* Profit Trends Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Daily profit trends</CardTitle>
              <CardDescription>Revenue, gross profit, and net profit by day</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full min-h-[260px] sm:h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={profitAnalysis?.dailyTrends || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(date) => format(new Date(date), 'MMM d')}
                  />
                  <YAxis tickFormatter={(value) => `$${value}`} />
                  <Tooltip 
                    formatter={(value: any) => formatCurrency(value)}
                    labelFormatter={(date) => format(new Date(date), 'MMMM d, yyyy')}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" stroke="#3B82F6" name="Revenue" strokeWidth={2} />
                  <Line type="monotone" dataKey="grossProfit" stroke="#10B981" name="Gross Profit" strokeWidth={2} />
                  <Line type="monotone" dataKey="netProfit" stroke="#8B5CF6" name="Net Profit" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Expense Report Tab */}
        <TabsContent value="expenses" className="space-y-6">
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Expense totals
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Overhead</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums tracking-tight" data-testid="text-overhead">
                  {formatCurrency(expenseReport?.summary?.overheadTotal || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Avg per day in period: {formatCurrency(expenseReport?.summary?.dailyOverhead || 0)}
                </p>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Order expenses</CardTitle>
                <Receipt className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums tracking-tight" data-testid="text-order-expenses">
                  {formatCurrency(expenseReport?.summary?.orderExpenseTotal || 0)}
                </div>
                <p className="text-xs text-muted-foreground">Shipping, fees, and other per-order costs</p>
              </CardContent>
            </Card>

            <Card className="border-destructive/20 shadow-sm sm:col-span-2 lg:col-span-1">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Combined total</CardTitle>
                <DollarSign className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums tracking-tight text-red-600" data-testid="text-total-expenses">
                  {formatCurrency(expenseReport?.summary?.totalExpenses || 0)}
                </div>
                <p className="text-xs text-muted-foreground">Overhead plus order expenses</p>
              </CardContent>
            </Card>
            </div>
          </div>

          <Separator />

          {/* Expense Categories */}
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Where spend went
            </h2>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Overhead by category</CardTitle>
                <CardDescription>Rent, utilities, payroll, and other fixed or recurring items</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <RechartsPI>
                    <Pie
                      data={expenseReport?.overheadByCategory || []}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(entry) => `${entry.category}: ${formatPercent(entry.percentage)}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="total"
                    >
                      {(expenseReport?.overheadByCategory || []).map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: any) => formatCurrency(value)} />
                  </RechartsPI>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Order expenses by category</CardTitle>
                <CardDescription>Grouped by how order-level costs were classified</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={expenseReport?.orderExpensesByCategory || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="category" />
                    <YAxis tickFormatter={(value) => `$${value}`} />
                    <Tooltip formatter={(value: any) => formatCurrency(value)} />
                    <Bar dataKey="total" fill="#3B82F6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            </div>
          </div>

          {/* Daily Expense Trends */}
          <Card>
            <CardHeader>
              <CardTitle>Daily expense trends</CardTitle>
              <CardDescription>Compare order-linked costs vs allocated overhead by day</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[280px] w-full min-h-[240px] sm:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={expenseReport?.dailyTrends || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(date) => format(new Date(date), 'MMM d')}
                  />
                  <YAxis tickFormatter={(value) => `$${value}`} />
                  <Tooltip 
                    formatter={(value: any) => formatCurrency(value)}
                    labelFormatter={(date) => format(new Date(date), 'MMMM d, yyyy')}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="orderExpenses" stroke="#F59E0B" name="Order Expenses" strokeWidth={2} />
                  <Line type="monotone" dataKey="overhead" stroke="#EF4444" name="Daily Overhead" strokeWidth={2} />
                  <Line type="monotone" dataKey="total" stroke="#8B5CF6" name="Total" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Profit Margins Tab */}
        <TabsContent value="margins" className="space-y-6">
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Margin overview
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Gross margin</CardTitle>
                <CardDescription>After cost of goods sold</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-3xl font-bold tabular-nums text-green-600">
                    {formatPercent(profitAnalysis?.summary?.grossMargin || 0)}
                  </div>
                  <Progress value={profitAnalysis?.summary?.grossMargin || 0} className="h-3" />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Operating margin</CardTitle>
                <CardDescription>After overhead and order expenses</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-3xl font-bold tabular-nums text-blue-600">
                    {formatPercent(profitAnalysis?.summary?.operatingMargin || 0)}
                  </div>
                  <Progress value={profitAnalysis?.summary?.operatingMargin || 0} className="h-3" />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm sm:col-span-2 lg:col-span-1">
              <CardHeader>
                <CardTitle>Net margin</CardTitle>
                <CardDescription>Final % retained from revenue</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div
                    className={`text-3xl font-bold tabular-nums ${
                      profitAnalysis?.summary?.netMargin >= 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {formatPercent(profitAnalysis?.summary?.netMargin || 0)}
                  </div>
                  <Progress
                    value={Math.abs(profitAnalysis?.summary?.netMargin || 0)}
                    className="h-3"
                  />
                </div>
              </CardContent>
            </Card>
            </div>
          </div>

          <Separator />

          {/* Cost Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Cost structure</CardTitle>
              <CardDescription>Walk from revenue to net profit for the active period</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Revenue</span>
                  <span className="text-sm font-bold tabular-nums">{formatCurrency(profitAnalysis?.summary?.revenue || 0)}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm">Cost of goods sold</span>
                  <span className="text-sm tabular-nums text-red-600">−{formatCurrency(profitAnalysis?.summary?.cogs || 0)}</span>
                </div>
                <div className="flex items-center justify-between font-medium">
                  <span className="text-sm">Gross profit</span>
                  <span className="text-sm tabular-nums text-green-600">{formatCurrency(profitAnalysis?.summary?.grossProfit || 0)}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm">Operating expenses</span>
                  <span className="text-sm tabular-nums text-red-600">−{formatCurrency(profitAnalysis?.expenses?.total || 0)}</span>
                </div>
                <div className="ml-1 space-y-2 border-l-2 border-muted pl-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Overhead</span>
                    <span className="tabular-nums text-muted-foreground">{formatCurrency(profitAnalysis?.expenses?.overhead || 0)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Order expenses</span>
                    <span className="tabular-nums text-muted-foreground">{formatCurrency(profitAnalysis?.expenses?.orderExpenses || 0)}</span>
                  </div>
                </div>
                <Separator />
                <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
                  <span className="text-sm font-bold">Net profit</span>
                  <span
                    className={`text-sm font-bold tabular-nums ${
                      profitAnalysis?.summary?.netProfit >= 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {formatCurrency(profitAnalysis?.summary?.netProfit || 0)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Daily Margin Trends */}
          <Card>
            <CardHeader>
              <CardTitle>Daily margin trends</CardTitle>
              <CardDescription>Gross vs net margin percentage by day</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[280px] w-full min-h-[240px] sm:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={profitAnalysis?.dailyTrends || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(date) => format(new Date(date), 'MMM d')}
                  />
                  <YAxis tickFormatter={(value) => `${value}%`} />
                  <Tooltip 
                    formatter={(value: any) => formatPercent(value)}
                    labelFormatter={(date) => format(new Date(date), 'MMMM d, yyyy')}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="grossMargin" stroke="#10B981" name="Gross Margin %" strokeWidth={2} />
                  <Line type="monotone" dataKey="netMargin" stroke="#8B5CF6" name="Net Margin %" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}