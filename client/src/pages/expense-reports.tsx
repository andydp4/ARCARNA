import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { 
  TrendingUp, TrendingDown, DollarSign, Package, Receipt, FileText, 
  Download, Calendar, PieChart, BarChart3, Activity
} from "lucide-react";
import { format } from "date-fns";
import {
  LineChart, Line, BarChart, Bar, PieChart as RechartsPI, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#64748B'];

export function ExpenseReportsPage() {
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
  
  const exportToCSV = (data: any, filename: string) => {
    const csvContent = "data:text/csv;charset=utf-8," + 
      Object.keys(data[0]).join(",") + "\n" +
      data.map((e: any) => Object.values(e).join(",")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${filename}_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  const isLoading = expenseLoading || profitLoading;
  
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
  
  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Financial Reports</h1>
          <p className="text-muted-foreground">Expense tracking and profit analysis</p>
        </div>
        <div className="flex gap-4 items-center">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[180px]" data-testid="select-date-range">
              <SelectValue />
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
            onClick={() => exportToCSV(profitAnalysis?.dailyTrends || [], 'profit_report')}
            data-testid="button-export"
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>
      
      {/* Period Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Report Period</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {format(startDate, 'MMMM d, yyyy')} - {format(endDate, 'MMMM d, yyyy')} ({expenseReport?.period?.days || 0} days)
          </p>
        </CardContent>
      </Card>
      
      <Tabs defaultValue="profit" className="space-y-4">
        <TabsList>
          <TabsTrigger value="profit">
            <TrendingUp className="mr-2 h-4 w-4" />
            Profit Analysis
          </TabsTrigger>
          <TabsTrigger value="expenses">
            <Receipt className="mr-2 h-4 w-4" />
            Expense Report
          </TabsTrigger>
          <TabsTrigger value="margins">
            <PieChart className="mr-2 h-4 w-4" />
            Profit Margins
          </TabsTrigger>
        </TabsList>
        
        {/* Profit Analysis Tab */}
        <TabsContent value="profit" className="space-y-4">
          {/* Key Metrics */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-revenue">
                  {formatCurrency(profitAnalysis?.summary?.revenue || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {profitAnalysis?.summary?.orderCount || 0} orders
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Gross Profit</CardTitle>
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600" data-testid="text-gross-profit">
                  {formatCurrency(profitAnalysis?.summary?.grossProfit || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatPercent(profitAnalysis?.summary?.grossMargin || 0)} margin
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Operating Profit</CardTitle>
                <Activity className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600" data-testid="text-operating-profit">
                  {formatCurrency(profitAnalysis?.summary?.operatingProfit || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatPercent(profitAnalysis?.summary?.operatingMargin || 0)} margin
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
                {profitAnalysis?.summary?.netProfit >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-500" />
                )}
              </CardHeader>
              <CardContent>
                <div 
                  className={`text-2xl font-bold ${
                    profitAnalysis?.summary?.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}
                  data-testid="text-net-profit"
                >
                  {formatCurrency(profitAnalysis?.summary?.netProfit || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatPercent(profitAnalysis?.summary?.netMargin || 0)} margin
                </p>
              </CardContent>
            </Card>
          </div>
          
          {/* Profit Trends Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Daily Profit Trends</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
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
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Expense Report Tab */}
        <TabsContent value="expenses" className="space-y-4">
          {/* Expense Summary */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Overhead Expenses</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-overhead">
                  {formatCurrency(expenseReport?.summary?.overheadTotal || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Daily: {formatCurrency(expenseReport?.summary?.dailyOverhead || 0)}
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Order Expenses</CardTitle>
                <Receipt className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-order-expenses">
                  {formatCurrency(expenseReport?.summary?.orderExpenseTotal || 0)}
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                <DollarSign className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600" data-testid="text-total-expenses">
                  {formatCurrency(expenseReport?.summary?.totalExpenses || 0)}
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Expense Categories */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Overhead by Category</CardTitle>
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
                <CardTitle>Order Expenses by Category</CardTitle>
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
          
          {/* Daily Expense Trends */}
          <Card>
            <CardHeader>
              <CardTitle>Daily Expense Trends</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
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
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Profit Margins Tab */}
        <TabsContent value="margins" className="space-y-4">
          {/* Margin Overview */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Gross Margin</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-3xl font-bold text-green-600">
                    {formatPercent(profitAnalysis?.summary?.grossMargin || 0)}
                  </div>
                  <Progress value={profitAnalysis?.summary?.grossMargin || 0} className="h-3" />
                  <p className="text-sm text-muted-foreground">
                    Revenue minus cost of goods sold
                  </p>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Operating Margin</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-3xl font-bold text-blue-600">
                    {formatPercent(profitAnalysis?.summary?.operatingMargin || 0)}
                  </div>
                  <Progress value={profitAnalysis?.summary?.operatingMargin || 0} className="h-3" />
                  <p className="text-sm text-muted-foreground">
                    After operating expenses
                  </p>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Net Margin</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className={`text-3xl font-bold ${
                    profitAnalysis?.summary?.netMargin >= 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    {formatPercent(profitAnalysis?.summary?.netMargin || 0)}
                  </div>
                  <Progress 
                    value={Math.abs(profitAnalysis?.summary?.netMargin || 0)} 
                    className="h-3" 
                  />
                  <p className="text-sm text-muted-foreground">
                    Bottom line profit margin
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Cost Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Cost Structure Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Revenue</span>
                  <span className="text-sm font-bold">{formatCurrency(profitAnalysis?.summary?.revenue || 0)}</span>
                </div>
                <Separator />
                <div className="flex justify-between items-center">
                  <span className="text-sm">Cost of Goods Sold</span>
                  <span className="text-sm text-red-600">-{formatCurrency(profitAnalysis?.summary?.cogs || 0)}</span>
                </div>
                <div className="flex justify-between items-center font-medium">
                  <span className="text-sm">= Gross Profit</span>
                  <span className="text-sm text-green-600">{formatCurrency(profitAnalysis?.summary?.grossProfit || 0)}</span>
                </div>
                <Separator />
                <div className="flex justify-between items-center">
                  <span className="text-sm">Operating Expenses</span>
                  <span className="text-sm text-red-600">-{formatCurrency(profitAnalysis?.expenses?.total || 0)}</span>
                </div>
                <div className="ml-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">• Overhead</span>
                    <span className="text-xs text-muted-foreground">{formatCurrency(profitAnalysis?.expenses?.overhead || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">• Order Expenses</span>
                    <span className="text-xs text-muted-foreground">{formatCurrency(profitAnalysis?.expenses?.orderExpenses || 0)}</span>
                  </div>
                </div>
                <Separator />
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold">= Net Profit</span>
                  <span className={`text-sm font-bold ${
                    profitAnalysis?.summary?.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    {formatCurrency(profitAnalysis?.summary?.netProfit || 0)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Daily Margin Trends */}
          <Card>
            <CardHeader>
              <CardTitle>Daily Margin Trends</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}