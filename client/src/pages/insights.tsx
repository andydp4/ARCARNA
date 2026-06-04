import { useState, useMemo, useCallback } from "react";
import { apiFetch } from "@/lib/appPaths";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subDays } from "date-fns";
import {
  Download,
  Calendar as CalendarIcon,
  TrendingUp,
  Users,
  DollarSign,
  ShoppingCart,
  BarChart3,
} from "lucide-react";
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
import { InsightsPageSkeleton } from "@/components/reporting-skeletons";
import { ActionLoader } from "@/components/action-loader";
import { DataTableShell, DataTableScrollRegion } from "@/components/data-table-shell";
import { SpatialInsightsShell } from "@/components/spatial/SpatialInsightsShell";
import { useFlag } from "@/hooks/useFlag";
import { PageHeader, LM_CARD } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";

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

function toNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

function useSpatialInsightsMode(): boolean {
  const spatialQueryOverride =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("spatial") === "1";
  const { enabled: spatialFlagEnabled } = useFlag("spatialWorkspace");
  return spatialFlagEnabled || spatialQueryOverride;
}

export default function Insights() {
  const { toast } = useToast();
  const spatialMode = useSpatialInsightsMode();
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

  const fromIso = dateRange.from.toISOString();
  const toIso = dateRange.to.toISOString();

  const {
    data: reportData,
    isLoading,
    isFetching,
  } = useQuery<ReportData>({
    queryKey: ["/api/reports", fromIso, toIso],
    queryFn: async () => {
      const params = new URLSearchParams({ from: fromIso, to: toIso });
      const response = await apiFetch(`/api/reports?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch report data");
      return response.json();
    },
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
  });
  const reportsInitialLoad = isLoading && !reportData;

  const summaryStats = useMemo(() => {
    const r = reportData;
    if (!r) {
      return { revenue: 0, orders: 0, customers: 0, avgOrder: 0 };
    }
    return {
      revenue: toNum(r.revenue?.total),
      orders: r.orders?.total ?? 0,
      customers: r.customers?.total ?? 0,
      avgOrder: toNum(r.orders?.average),
    };
  }, [reportData]);

  const reportsEmpty =
    !reportsInitialLoad && summaryStats.orders === 0 && summaryStats.revenue === 0;

  const revenueByDay = useMemo(() => reportData?.revenue?.byDay ?? [], [reportData]);
  const revenueByCategory = useMemo(() => reportData?.revenue?.byCategory ?? [], [reportData]);
  const paymentMethods = useMemo(() => reportData?.revenue?.byPaymentMethod ?? [], [reportData]);
  const hourlyDistribution = useMemo(() => reportData?.orders?.hourlyDistribution ?? [], [reportData]);
  const topProducts = useMemo(() => reportData?.orders?.topProducts?.slice(0, 5) ?? [], [reportData]);
  const topCustomers = useMemo(() => reportData?.customers?.topCustomers?.slice(0, 5) ?? [], [reportData]);
  const rfmSegments = useMemo(() => reportData?.customers?.rfmSegments ?? [], [reportData]);
  const topMoving = useMemo(() => reportData?.inventory?.topMoving?.slice(0, 10) ?? [], [reportData]);

  const topMovingWithRate = useMemo(
    () =>
      topMoving.map((product) => ({
        ...product,
        movementPct: ((product.sold / (product.sold + product.remaining)) * 100).toFixed(1),
      })),
    [topMoving]
  );

  const categoryPieCells = useMemo(
    () =>
      revenueByCategory.map((_, index) => (
        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
      )),
    [revenueByCategory]
  );

  const customerSegmentKpi = useMemo(() => {
    const c = reportData?.customers;
    if (!c) return { new: 0, returning: 0, retentionPct: "0" };
    const total = c.total ?? 0;
    const retentionPct = total ? ((c.returning / total) * 100).toFixed(1) : "0";
    return { new: c.new ?? 0, returning: c.returning ?? 0, retentionPct };
  }, [reportData]);

  const inventoryKpi = useMemo(() => {
    const i = reportData?.inventory;
    if (!i) {
      return { totalValue: 0, lowStock: 0, outOfStock: 0, turnover: "0.0" };
    }
    return {
      totalValue: toNum(i.totalValue),
      lowStock: i.lowStock ?? 0,
      outOfStock: i.outOfStock ?? 0,
      turnover: i.turnoverRate != null ? i.turnoverRate.toFixed(1) : "0.0",
    };
  }, [reportData]);

  const handlePresetRange = useCallback((preset: string) => {
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
  }, []);

  const handleExport = useCallback(async (type: "revenue" | "orders" | "customers" | "inventory" | "full") => {
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
  }, [dateRange, exportFormat, toast]);

  const insightsBody = reportsInitialLoad ? (
    <InsightsPageSkeleton />
  ) : (
    <>
        {/* Date Range Controls */}
        <Card className={`mb-8 ${LM_CARD}`}>
          <CardHeader className="space-y-0 pb-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-lg">Report period</CardTitle>
                <CardDescription className="mt-1.5 text-sm leading-relaxed">
                  Presets update both dates; fine-tune with the calendars. Every chart and table below uses this range.
                </CardDescription>
              </div>
              {isFetching && reportData && (
                <p className="text-xs text-muted-foreground shrink-0" aria-live="polite">
                  Refreshing report…
                </p>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end">
              {/* Preset Ranges */}
              <div className="min-w-0 flex-1 space-y-2">
                <Label className="text-muted-foreground">Quick range</Label>
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
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">From</Label>
                  <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start min-h-[44px]" data-testid="button-date-from">
                      <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
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
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">To</Label>
                  <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start min-h-[44px]" data-testid="button-date-to">
                      <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
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
              </div>

              <Separator className="lg:hidden" />

              {/* Export Options */}
              <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap lg:w-auto lg:max-w-sm lg:flex-nowrap">
                <div className="min-w-0 flex-1 space-y-2 sm:flex-initial">
                  <Label className="text-muted-foreground">Export format</Label>
                  <Select value={exportFormat} onValueChange={(value: "csv" | "pdf") => setExportFormat(value)}>
                    <SelectTrigger className="min-h-[44px] w-full sm:w-[140px]" data-testid="select-export-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="csv">CSV</SelectItem>
                      <SelectItem value="pdf">PDF</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={() => handleExport("full")}
                    disabled={isExporting}
                    className="min-h-[44px] w-full justify-center gap-2 sm:min-w-[10.5rem] sm:w-auto lm-btn-metal"
                    data-testid="button-export-full"
                  >
                    {isExporting ? (
                      <>
                        <ActionLoader className="text-primary-foreground" />
                        Exporting…
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        Download full report
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {reportsEmpty ? (
          <EmptyState
            icon={BarChart3}
            title="No activity in this period"
            body="There are no orders or revenue in the selected date range. Process a sale in POS or try a wider preset."
            cta={{ label: "Open POS", href: "/pos" }}
            secondary={{ label: "Last 30 days", onClick: () => handlePresetRange("last30") }}
          />
        ) : (
        <>
        {/* Summary Cards */}
        <div className="mb-2 grid grid-cols-2 gap-4 sm:gap-4 lg:grid-cols-4">
          <Card className={LM_CARD}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-metal-muted">Total revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-2">
                <p className="text-2xl font-bold tabular-nums tracking-tight">${summaryStats.revenue.toFixed(2)}</p>
                <DollarSign className="h-5 w-5 shrink-0 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>

          <Card className={LM_CARD}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total orders</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-2">
                <p className="text-2xl font-bold tabular-nums tracking-tight">{summaryStats.orders}</p>
                <ShoppingCart className="h-5 w-5 shrink-0 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>

          <Card className={LM_CARD}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active customers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-2">
                <p className="text-2xl font-bold tabular-nums tracking-tight">{summaryStats.customers}</p>
                <Users className="h-5 w-5 shrink-0 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>

          <Card className={LM_CARD}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg order value</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-2">
                <p className="text-2xl font-bold tabular-nums tracking-tight">${summaryStats.avgOrder.toFixed(2)}</p>
                <TrendingUp className="h-5 w-5 shrink-0 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </div>
        <p className="mb-8 mt-4 text-xs leading-relaxed text-muted-foreground sm:text-sm">
          Figures below use{" "}
          <span className="font-medium text-foreground">{format(dateRange.from, "PP")}</span>
          {" "}–{" "}
          <span className="font-medium text-foreground">{format(dateRange.to, "PP")}</span>.
        </p>

        {/* Detailed Reports Tabs */}
        <Tabs defaultValue="revenue" className="space-y-8">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1.5 rounded-xl border border-border/60 bg-muted/45 p-1.5 lg:grid-cols-4">
            <TabsTrigger value="revenue" className="min-h-[44px] rounded-lg data-[state=active]:shadow-sm">
              Revenue
            </TabsTrigger>
            <TabsTrigger value="orders" className="min-h-[44px] rounded-lg data-[state=active]:shadow-sm">
              Orders
            </TabsTrigger>
            <TabsTrigger value="customers" className="min-h-[44px] rounded-lg data-[state=active]:shadow-sm">
              Customers
            </TabsTrigger>
            <TabsTrigger value="inventory" className="min-h-[44px] rounded-lg data-[state=active]:shadow-sm">
              Inventory
            </TabsTrigger>
          </TabsList>

          {/* Revenue Tab */}
          <TabsContent value="revenue" className="space-y-6">
            <Card className={LM_CARD}>
              <CardHeader className="space-y-0 pb-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-lg">Revenue analysis</CardTitle>
                    <CardDescription className="mt-1.5 leading-relaxed">
                      Daily revenue and orders in the selected period
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleExport("revenue")}
                    disabled={isExporting}
                    className="min-h-[44px] w-full justify-center gap-2 sm:min-w-[9.5rem] sm:w-auto sm:shrink-0"
                    data-testid="button-export-revenue"
                  >
                    {isExporting ? (
                      <>
                        <ActionLoader className="text-primary" />
                        Exporting…
                      </>
                    ) : (
                      <>
                        <Download className="h-3.5 w-3.5" />
                        Export this tab
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[280px] w-full min-h-[240px] sm:h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenueByDay}>
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
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card className={LM_CARD}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Revenue by category</CardTitle>
                  <CardDescription className="mt-1 leading-relaxed">Share of revenue by product category</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[220px] w-full min-h-[200px] sm:h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart>
                      <Pie
                        data={revenueByCategory}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="revenue"
                        label
                      >
                        {categoryPieCells}
                      </Pie>
                      <Tooltip />
                    </RePieChart>
                  </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className={LM_CARD}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Payment methods</CardTitle>
                  <CardDescription className="mt-1 leading-relaxed">Volume and revenue by tender type</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <DataTableShell className="overflow-x-auto">
                    <Table scrollContainerClassName="overflow-visible">
                      <TableHeader>
                        <TableRow className="border-b bg-muted/40 hover:bg-muted/40">
                          <TableHead>Method</TableHead>
                          <TableHead className="text-right tabular-nums">Orders</TableHead>
                          <TableHead className="text-right tabular-nums">Revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paymentMethods.length > 0 ? (
                          paymentMethods.map((method) => (
                            <TableRow key={method.method} data-testid={`payment-method-${method.method}`}>
                              <TableCell className="font-medium">{method.method}</TableCell>
                              <TableCell className="text-right tabular-nums">{method.count}</TableCell>
                              <TableCell className="text-right tabular-nums font-medium">
                                ${toNum(method.revenue).toFixed(2)}
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={3} className="h-14 text-center text-sm text-muted-foreground">
                              No payment data in this period
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </DataTableShell>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Orders Tab */}
          <TabsContent value="orders" className="space-y-6">
            <Card className={LM_CARD}>
              <CardHeader className="space-y-0 pb-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-lg">Order analysis</CardTitle>
                    <CardDescription className="mt-1.5 leading-relaxed">When orders land and what sold best</CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleExport("orders")}
                    disabled={isExporting}
                    className="min-h-[44px] w-full justify-center gap-2 sm:min-w-[9.5rem] sm:w-auto sm:shrink-0"
                    data-testid="button-export-orders"
                  >
                    {isExporting ? (
                      <>
                        <ActionLoader className="text-primary" />
                        Exporting…
                      </>
                    ) : (
                      <>
                        <Download className="h-3.5 w-3.5" />
                        Export this tab
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Orders by hour
                    </h4>
                    <div className="h-[220px] w-full min-h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={hourlyDistribution}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="hour" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="count" fill="#3B82F6" />
                      </BarChart>
                    </ResponsiveContainer>
                    </div>
                  </div>

                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Top products
                    </h4>
                    <DataTableShell className="overflow-x-auto">
                      <Table scrollContainerClassName="overflow-visible">
                        <TableHeader>
                          <TableRow className="border-b bg-muted/40 hover:bg-muted/40">
                            <TableHead>Product</TableHead>
                            <TableHead className="text-right tabular-nums">Quantity</TableHead>
                            <TableHead className="text-right tabular-nums">Revenue</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {topProducts.length > 0 ? (
                            topProducts.map((product) => (
                              <TableRow key={product.name} data-testid={`top-product-${product.name}`}>
                                <TableCell className="font-medium">{product.name}</TableCell>
                                <TableCell className="text-right tabular-nums">{product.quantity}</TableCell>
                                <TableCell className="text-right tabular-nums font-medium">
                                  ${toNum(product.revenue).toFixed(2)}
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell colSpan={3} className="h-14 text-center text-sm text-muted-foreground">
                                No product data in this period
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </DataTableShell>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Customers Tab */}
          <TabsContent value="customers" className="space-y-6">
            <Card className={LM_CARD}>
              <CardHeader className="space-y-0 pb-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-lg">Customer analysis</CardTitle>
                    <CardDescription className="mt-1.5 leading-relaxed">
                      Segments, retention, and highest-value buyers
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleExport("customers")}
                    disabled={isExporting}
                    className="min-h-[44px] w-full justify-center gap-2 sm:min-w-[9.5rem] sm:w-auto sm:shrink-0"
                    data-testid="button-export-customers"
                  >
                    {isExporting ? (
                      <>
                        <ActionLoader className="text-primary" />
                        Exporting…
                      </>
                    ) : (
                      <>
                        <Download className="h-3.5 w-3.5" />
                        Export this tab
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border/60 bg-muted/10 px-4 py-3 shadow-sm">
                    <p className="text-sm font-medium text-muted-foreground">New customers</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{customerSegmentKpi.new}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/10 px-4 py-3 shadow-sm">
                    <p className="text-sm font-medium text-muted-foreground">Returning</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{customerSegmentKpi.returning}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/10 px-4 py-3 shadow-sm">
                    <p className="text-sm font-medium text-muted-foreground">Retention rate</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">
                      {customerSegmentKpi.retentionPct}%
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Top customers
                    </h4>
                    <DataTableShell className="overflow-x-auto">
                      <Table scrollContainerClassName="overflow-visible">
                        <TableHeader>
                          <TableRow className="border-b bg-muted/40 hover:bg-muted/40">
                            <TableHead>Customer</TableHead>
                            <TableHead className="text-right tabular-nums">Orders</TableHead>
                            <TableHead className="text-right tabular-nums">Revenue</TableHead>
                            <TableHead className="text-right tabular-nums">Points</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {topCustomers.length > 0 ? (
                            topCustomers.map((customer) => (
                              <TableRow key={customer.name} data-testid={`top-customer-${customer.name}`}>
                                <TableCell className="font-medium">{customer.name}</TableCell>
                                <TableCell className="text-right tabular-nums">{customer.orders}</TableCell>
                                <TableCell className="text-right tabular-nums font-medium">
                                  ${toNum(customer.revenue).toFixed(2)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{customer.loyalty}</TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell colSpan={4} className="h-14 text-center text-sm text-muted-foreground">
                                No customer data in this period
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </DataTableShell>
                  </div>

                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      RFM segments
                    </h4>
                    <DataTableShell className="overflow-x-auto">
                      <Table scrollContainerClassName="overflow-visible">
                        <TableHeader>
                          <TableRow className="border-b bg-muted/40 hover:bg-muted/40">
                            <TableHead>Segment</TableHead>
                            <TableHead className="text-right tabular-nums">Count</TableHead>
                            <TableHead className="text-right tabular-nums">Avg revenue</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rfmSegments.length > 0 ? (
                            rfmSegments.map((segment) => (
                              <TableRow key={segment.segment} data-testid={`rfm-segment-${segment.segment}`}>
                                <TableCell className="font-medium">{segment.segment}</TableCell>
                                <TableCell className="text-right tabular-nums">{segment.count}</TableCell>
                                <TableCell className="text-right tabular-nums font-medium">
                                  ${toNum(segment.avgRevenue).toFixed(2)}
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell colSpan={3} className="h-14 text-center text-sm text-muted-foreground">
                                No segment data in this period
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </DataTableShell>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Inventory Tab */}
          <TabsContent value="inventory" className="space-y-6">
            <Card className={LM_CARD}>
              <CardHeader className="space-y-0 pb-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-lg">Inventory analysis</CardTitle>
                    <CardDescription className="mt-1.5 leading-relaxed">Stock value, risk SKUs, and velocity</CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleExport("inventory")}
                    disabled={isExporting}
                    className="min-h-[44px] w-full justify-center gap-2 sm:min-w-[9.5rem] sm:w-auto sm:shrink-0"
                    data-testid="button-export-inventory"
                  >
                    {isExporting ? (
                      <>
                        <ActionLoader className="text-primary" />
                        Exporting…
                      </>
                    ) : (
                      <>
                        <Download className="h-3.5 w-3.5" />
                        Export this tab
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                  <div className="rounded-lg border border-border/60 bg-muted/10 px-4 py-3 shadow-sm">
                    <p className="text-sm font-medium text-muted-foreground">Stock value</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">
                      ${inventoryKpi.totalValue.toFixed(2)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/10 px-4 py-3 shadow-sm">
                    <p className="text-sm font-medium text-muted-foreground">Low stock</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-orange-600">
                      {inventoryKpi.lowStock}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/10 px-4 py-3 shadow-sm">
                    <p className="text-sm font-medium text-muted-foreground">Out of stock</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-red-600">
                      {inventoryKpi.outOfStock}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/10 px-4 py-3 shadow-sm sm:col-span-2 lg:col-span-1">
                    <p className="text-sm font-medium text-muted-foreground">Turnover</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">
                      {inventoryKpi.turnover}×
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Fastest-moving products
                  </h4>
                  <DataTableScrollRegion>
                    <Table scrollContainerClassName="overflow-visible">
                      <TableHeader className="sticky top-0 z-[1] bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                        <TableRow className="border-b-0 bg-muted/40 hover:bg-muted/40">
                          <TableHead>Product</TableHead>
                          <TableHead className="text-right tabular-nums">Sold</TableHead>
                          <TableHead className="text-right tabular-nums">Remaining</TableHead>
                          <TableHead className="text-right tabular-nums">Movement rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topMovingWithRate.length > 0 ? (
                          topMovingWithRate.map((product) => (
                            <TableRow key={product.product} data-testid={`top-moving-${product.product}`}>
                              <TableCell className="font-medium">{product.product}</TableCell>
                              <TableCell className="text-right tabular-nums">{product.sold}</TableCell>
                              <TableCell className="text-right tabular-nums">{product.remaining}</TableCell>
                              <TableCell className="text-right tabular-nums font-medium">{product.movementPct}%</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={4} className="h-14 text-center text-sm text-muted-foreground">
                              No movement data in this period
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </DataTableScrollRegion>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        </>
        )}
    </>
  );

  if (spatialMode) {
    return (
      <SpatialInsightsShell
        summaryStats={summaryStats}
        dateFrom={dateRange.from}
        dateTo={dateRange.to}
      >
        {insightsBody}
      </SpatialInsightsShell>
    );
  }

  return (
    <div className="w-full">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <PageHeader
          icon={BarChart3}
          title="Business insights"
          description="Pick a period, explore revenue and operations, then export CSV or PDF when you need to share."
        />
        {insightsBody}
      </div>
    </div>
  );
}