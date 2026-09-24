/**
 * The widgets on Truths at a glance (v1.2 Phase 3). Each one reads the same
 * API as the page it summarises, so a widget can never show a figure its
 * page would not; and each states its window on its face.
 *
 * Phones get no pop-ups: chart tooltips are left out below `sm:` and every
 * figure a tooltip would carry is printed in the widget instead.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowRight } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "@/lib/appPaths";
import { apiRequest } from "@/lib/queryClient";
import { useReport } from "@/hooks/useReport";
import { COLORS, CHART_POSITIVE, CHART_PRIMARY } from "@/lib/chartColors";
import { money, pct, isoDate } from "@/lib/reportBrand";
import { formatPaymentLabel } from "@/lib/paymentLabel";
import { Skeleton } from "@/components/Skeleton";
import { HourHeatmap } from "@/components/charts/HourHeatmap";
import { Badge } from "@/components/ui/badge";
import { REPORT_CATALOG, TIER_LABEL, type ReportTier } from "@shared/evidenceCatalog";
import {
  TRUTHS_WINDOWS,
  truthsWidget,
  windowDays,
  windowRange,
  windowWeeks,
  type TruthsLayoutEntry,
  type TruthsWindow,
} from "@shared/truthsLayout";
import type { HourOfDayBucket } from "@shared/analytics/hourOfDay";
import type { ChannelAttributionRow } from "@shared/analytics/channelAttribution";
import type { StockTurnCategoryRow } from "@shared/analytics/stockTurn";
import { RFM_SEGMENTS, type RfmSegment } from "@shared/analytics/rfm";

type Ctx = { window: TruthsWindow; isPhone: boolean };

function toNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Data. The eight Truths Hub widgets share GET /api/reports; widgets on the
// same window share one request through the query cache.
// ---------------------------------------------------------------------------

interface HubData {
  revenue: {
    total: number;
    /** Of which delivery fees (v1.2.1), VAT included, less fees refunded. */
    deliveryFees?: number;
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

function useHubData(window: TruthsWindow) {
  const range = windowRange(window) ?? windowRange("month")!;
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();
  return useQuery<HubData>({
    queryKey: ["/api/reports", fromIso, toIso],
    queryFn: async () => {
      const params = new URLSearchParams({ from: fromIso, to: toIso });
      const res = await apiFetch(`/api/reports?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 30_000,
  });
}

function useJson<T>(key: unknown[], url: string) {
  return useQuery<T>({
    queryKey: key,
    queryFn: async () => {
      const res = await apiFetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Small building blocks.
// ---------------------------------------------------------------------------

function Loading() {
  return <Skeleton className="h-32 w-full" />;
}

function Failed() {
  return <p className="text-sm text-muted-foreground">This couldn't load. It will try again shortly.</p>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function Kpi({ label, value, tone }: { label: string; value: ReactNode; tone?: "warn" | "bad" }) {
  const colour = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-orange-600" : "";
  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums tracking-tight ${colour}`}>{value}</p>
    </div>
  );
}

type Col<T> = { header: string; cell: (row: T) => ReactNode; right?: boolean };

function MiniTable<T>({ rows, cols, rowKey, empty }: { rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; empty: string }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            {cols.map((c) => (
              <th key={c.header} className={`py-1.5 font-medium ${c.right ? "text-right" : "text-left"}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-border/40 last:border-0">
              {cols.map((c) => (
                <td key={c.header} className={`py-1.5 ${c.right ? "text-right tabular-nums" : "font-medium"}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Truths Hub widgets (formerly /insights).
// ---------------------------------------------------------------------------

function SalesSummary({ window }: Ctx) {
  const { data, isLoading, isError } = useHubData(window);
  if (isLoading) return <Loading />;
  if (isError || !data) return <Failed />;
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Kpi label="Revenue" value={money(toNum(data.revenue?.total))} />
      <Kpi label="Orders" value={data.orders?.total ?? 0} />
      <Kpi label="Active customers" value={data.customers?.total ?? 0} />
      <Kpi label="Avg order value" value={money(toNum(data.orders?.average))} />
      {toNum(data.revenue?.deliveryFees) > 0 && (
        <Kpi label="Of which delivery fees" value={money(toNum(data.revenue?.deliveryFees))} />
      )}
    </div>
  );
}

function RevenueByDay({ window, isPhone }: Ctx) {
  const { data, isLoading, isError } = useHubData(window);
  if (isLoading) return <Loading />;
  if (isError || !data) return <Failed />;
  const rows = data.revenue?.byDay ?? [];
  if (rows.length === 0) return <Empty>No sales in this window.</Empty>;
  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ left: 0, right: isPhone ? 0 : 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: isPhone ? 10 : 12 }}
            tickFormatter={(d) => {
              const date = new Date(d);
              return Number.isNaN(date.getTime()) ? d : format(date, "d MMM");
            }}
            interval="preserveStartEnd"
            minTickGap={isPhone ? 24 : 12}
          />
          <YAxis yAxisId="left" tick={{ fontSize: isPhone ? 10 : 12 }} width={isPhone ? 32 : 40} />
          <YAxis yAxisId="right" orientation="right" hide={isPhone} />
          {!isPhone && <Tooltip />}
          <Legend />
          <Line yAxisId="left" type="monotone" dataKey="revenue" stroke={CHART_PRIMARY} name="Revenue (£)" dot={false} />
          <Line yAxisId="right" type="monotone" dataKey="orders" stroke={CHART_POSITIVE} name="Orders" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RevenueByCategory({ window, isPhone }: Ctx) {
  const { data, isLoading, isError } = useHubData(window);
  if (isLoading) return <Loading />;
  if (isError || !data) return <Failed />;
  const rows = data.revenue?.byCategory ?? [];
  if (rows.length === 0) return <Empty>No sales in this window.</Empty>;
  return (
    <div className="space-y-3">
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} cx="50%" cy="50%" outerRadius={isPhone ? 65 : 80} dataKey="revenue" nameKey="category" label={false}>
              {rows.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            {!isPhone && <Tooltip />}
          </PieChart>
        </ResponsiveContainer>
      </div>
      {/* The legend carries every figure, so nothing needs a hover to read. */}
      <ul className="space-y-1 text-sm">
        {rows.map((r, i) => (
          <li key={r.category} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="truncate">{r.category}</span>
            </span>
            <span className="tabular-nums text-muted-foreground">
              {money(toNum(r.revenue))} · {pct(toNum(r.percentage))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaymentMethods({ window }: Ctx) {
  const { data, isLoading, isError } = useHubData(window);
  if (isLoading) return <Loading />;
  if (isError || !data) return <Failed />;
  return (
    <MiniTable
      rows={data.revenue?.byPaymentMethod ?? []}
      rowKey={(r) => r.method}
      empty="No payments in this window."
      cols={[
        { header: "Method", cell: (r) => formatPaymentLabel(r.method) },
        { header: "Orders", cell: (r) => r.count, right: true },
        { header: "Revenue", cell: (r) => money(toNum(r.revenue)), right: true },
      ]}
    />
  );
}

function OrdersByHour({ window, isPhone }: Ctx) {
  const { data, isLoading, isError } = useHubData(window);
  if (isLoading) return <Loading />;
  if (isError || !data) return <Failed />;
  const rows = data.orders?.hourlyDistribution ?? [];
  if (rows.length === 0) return <Empty>No orders in this window.</Empty>;
  const peak = rows.reduce((best, r) => (r.count > best.count ? r : best), rows[0]);
  return (
    <div className="space-y-2">
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="hour" tick={{ fontSize: isPhone ? 10 : 12 }} interval={isPhone ? 2 : 0} />
            <YAxis tick={{ fontSize: isPhone ? 10 : 12 }} width={isPhone ? 28 : 40} allowDecimals={false} />
            {!isPhone && <Tooltip />}
            <Bar dataKey="count" name="Orders" fill={CHART_PRIMARY} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">
        Busiest hour: {String(peak.hour).padStart(2, "0")}:00 with {peak.count} orders.
      </p>
    </div>
  );
}

function TopProducts({ window }: Ctx) {
  const { data, isLoading, isError } = useHubData(window);
  if (isLoading) return <Loading />;
  if (isError || !data) return <Failed />;
  return (
    <MiniTable
      rows={(data.orders?.topProducts ?? []).slice(0, 5)}
      rowKey={(r) => r.name}
      empty="No products sold in this window."
      cols={[
        { header: "Product", cell: (r) => r.name },
        { header: "Qty", cell: (r) => r.quantity, right: true },
        { header: "Revenue", cell: (r) => money(toNum(r.revenue)), right: true },
      ]}
    />
  );
}

function CustomerMix({ window }: Ctx) {
  const { data, isLoading, isError } = useHubData(window);
  if (isLoading) return <Loading />;
  if (isError || !data) return <Failed />;
  const c = data.customers;
  const total = c?.total ?? 0;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="New" value={c?.new ?? 0} />
        <Kpi label="Returning" value={c?.returning ?? 0} />
        <Kpi label="Retention" value={total ? pct(((c?.returning ?? 0) / total) * 100) : "0%"} />
      </div>
      <MiniTable
        rows={c?.rfmSegments ?? []}
        rowKey={(r) => r.segment}
        empty="No segments in this window."
        cols={[
          { header: "Segment", cell: (r) => r.segment },
          { header: "Count", cell: (r) => r.count, right: true },
          { header: "Avg revenue", cell: (r) => money(toNum(r.avgRevenue)), right: true },
        ]}
      />
    </div>
  );
}

function TopCustomers({ window }: Ctx) {
  const { data, isLoading, isError } = useHubData(window);
  if (isLoading) return <Loading />;
  if (isError || !data) return <Failed />;
  return (
    <MiniTable
      rows={(data.customers?.topCustomers ?? []).slice(0, 5)}
      rowKey={(r) => r.name}
      empty="No customer orders in this window."
      cols={[
        { header: "Customer", cell: (r) => r.name },
        { header: "Orders", cell: (r) => r.orders, right: true },
        { header: "Revenue", cell: (r) => money(toNum(r.revenue)), right: true },
        { header: "Points", cell: (r) => r.loyalty, right: true },
      ]}
    />
  );
}

function StockMovement({ window }: Ctx) {
  const { data, isLoading, isError } = useHubData(window);
  if (isLoading) return <Loading />;
  if (isError || !data) return <Failed />;
  const i = data.inventory;
  const rows = (i?.topMoving ?? []).slice(0, 10);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi label="Stock value" value={money(toNum(i?.totalValue))} />
        <Kpi label="Low stock" value={i?.lowStock ?? 0} tone="warn" />
        <Kpi label="Out of stock" value={i?.outOfStock ?? 0} tone="bad" />
        <Kpi label="Turnover" value={`${toNum(i?.turnoverRate).toFixed(1)}×`} />
      </div>
      <MiniTable
        rows={rows}
        rowKey={(r) => r.product}
        empty="No stock moved in this window."
        cols={[
          { header: "Product", cell: (r) => r.product },
          { header: "Sold", cell: (r) => r.sold, right: true },
          { header: "Left", cell: (r) => r.remaining, right: true },
          {
            header: "Moved",
            cell: (r) => (r.sold + r.remaining > 0 ? pct((r.sold / (r.sold + r.remaining)) * 100) : "—"),
            right: true,
          },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The other visual Truths.
// ---------------------------------------------------------------------------

function BusiestHours({ window }: Ctx) {
  const weeks = windowWeeks(window) ?? 12;
  const { data, isLoading, isError } = useJson<{ buckets: HourOfDayBucket[] }>(
    ["/api/analytics/hour-of-day", weeks],
    `/api/analytics/hour-of-day?weeks=${weeks}`,
  );
  if (isLoading) return <Loading />;
  if (isError || !data) return <Failed />;
  return <HourHeatmap buckets={data.buckets ?? []} />;
}

const CHANNEL_LABELS: Record<string, string> = {
  pos: "In-store POS",
  web: "Web",
  api: "API",
  whatsapp: "WhatsApp",
  phone: "Phone",
};

function OrderChannels({ window }: Ctx) {
  const days = windowDays(window) ?? 90;
  const { data, isLoading, isError } = useJson<{ channels: ChannelAttributionRow[] }>(
    ["/api/analytics/channels", days],
    `/api/analytics/channels?days=${days}`,
  );
  if (isLoading) return <Loading />;
  if (isError || !data) return <Failed />;
  return (
    <MiniTable
      rows={data.channels ?? []}
      rowKey={(r) => r.channel}
      empty="No completed orders in this window."
      cols={[
        { header: "Channel", cell: (r) => CHANNEL_LABELS[r.channel] ?? r.channel },
        { header: "Orders", cell: (r) => r.orderCount, right: true },
        { header: "Revenue", cell: (r) => money(r.revenue), right: true },
        { header: "Share", cell: (r) => `${r.sharePct}%`, right: true },
      ]}
    />
  );
}

function StockTurn({ window }: Ctx) {
  const days = windowDays(window) ?? 90;
  const { data, isLoading, isError } = useJson<{ categories: StockTurnCategoryRow[] }>(
    ["/api/analytics/stock-turn", days],
    `/api/analytics/stock-turn?windowDays=${days}`,
  );
  if (isLoading) return <Loading />;
  if (isError || !data) return <Failed />;
  const rows = [...(data.categories ?? [])].sort((a, b) => b.daysOfStock - a.daysOfStock).slice(0, 8);
  return (
    <MiniTable
      rows={rows}
      rowKey={(r) => r.category}
      empty="No stock movement in this window."
      cols={[
        { header: "Category", cell: (r) => r.category },
        { header: "Sold", cell: (r) => r.unitsSold, right: true },
        { header: "Days of stock", cell: (r) => (Number.isFinite(r.daysOfStock) ? Math.round(r.daysOfStock) : "—"), right: true },
        { header: "Status", cell: (r) => r.status, right: true },
      ]}
    />
  );
}

function CustomerTruths(_: Ctx) {
  const { data, isLoading, isError } = useJson<{ segments: Record<RfmSegment, number>; computedAt: string | null; totalCustomers: number }>(
    ["/api/analytics/rfm"],
    "/api/analytics/rfm",
  );
  if (isLoading) return <Loading />;
  if (isError || !data) return <Failed />;
  const rows = RFM_SEGMENTS.map((s) => ({ segment: s, count: data.segments?.[s] ?? 0 }));
  return (
    <div className="space-y-2">
      <MiniTable
        rows={rows}
        rowKey={(r) => r.segment}
        empty="No customers scored yet."
        cols={[
          { header: "Segment", cell: (r) => r.segment },
          { header: "Customers", cell: (r) => r.count, right: true },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        {data.computedAt ? `Scored ${format(new Date(data.computedAt), "d MMM yyyy, HH:mm")}` : "Not scored yet"} ·{" "}
        {data.totalCustomers} customers
      </p>
    </div>
  );
}

function ProfitTruths({ window }: Ctx) {
  const range = windowRange(window) ?? windowRange("month")!;
  const start = range.from.toISOString();
  const end = range.to.toISOString();
  const { data, isLoading, isError } = useQuery<{ summary?: Record<string, number> }>({
    queryKey: ["/api/profit-analysis", start, end],
    queryFn: async () => (await apiRequest("GET", `/api/profit-analysis?startDate=${start}&endDate=${end}`)).json(),
    staleTime: 60_000,
  });
  if (isLoading) return <Loading />;
  if (isError || !data?.summary) return <Failed />;
  const s = data.summary;
  return (
    <div className="grid grid-cols-2 gap-2">
      <Kpi label="Revenue" value={money(toNum(s.revenue))} />
      <Kpi label="Cost of goods" value={money(toNum(s.cogs))} />
      <Kpi label="Gross profit" value={money(toNum(s.grossProfit))} />
      <Kpi label="Net profit" value={money(toNum(s.netProfit))} tone={toNum(s.netProfit) < 0 ? "bad" : undefined} />
      {toNum(s.deliveryFees) > 0 && (
        <Kpi label={s.deliveryFeesInMargin ? "Delivery fees (in margin)" : "Delivery fees (not in margin)"} value={money(toNum(s.deliveryFees))} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence.
// ---------------------------------------------------------------------------

const MONEY_KEY = /revenue|value|margin|profit|cost|balance|spend|sales|amount|clv|owed|overdue/i;
const PCT_KEY = /pct|percent|rate|share/i;

function humanise(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatSummary(key: string, value: number | string | null): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (PCT_KEY.test(key)) return pct(value);
  if (MONEY_KEY.test(key)) return money(value);
  return Number.isInteger(value) ? value.toLocaleString("en-GB") : value.toFixed(1);
}

function EvidenceWidget({ window, evidenceRef }: Ctx & { evidenceRef: string }) {
  const range = windowRange(window);
  const { data, isLoading, error } = useReport(
    evidenceRef,
    range ? { from: isoDate(range.from), to: isoDate(range.to) } : undefined,
  );
  if (isLoading) return <Loading />;
  if (error || !data) return <Failed />;
  const figures = Object.entries(data.summary ?? {})
    .filter(([, v]) => typeof v === "number" || (typeof v === "string" && v.length <= 24))
    .slice(0, 4);
  return (
    <div className="space-y-2">
      {figures.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {figures.map(([k, v]) => (
            <Kpi key={k} label={humanise(k)} value={formatSummary(k, v)} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{(data.rows ?? []).length} rows.</p>
      )}
      {(data.redFlags ?? []).length > 0 && (
        <p className="text-xs font-medium text-red-600">
          {data.redFlags.length} red flag{data.redFlags.length === 1 ? "" : "s"}: {data.redFlags[0]}
        </p>
      )}
    </div>
  );
}

/** Every piece of Evidence and what it shows; planned items are marked "coming". */
function EvidenceGuide(_: Ctx) {
  const tiers: ReportTier[] = [1, 2, 3, 4];
  return (
    <div className="space-y-4" data-testid="evidence-guide">
      {tiers.map((tier) => (
        <section key={tier}>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{TIER_LABEL[tier]}</h4>
          <ul className="divide-y divide-border/40">
            {REPORT_CATALOG.filter((r) => r.tier === tier).map((r) => (
              <li key={r.ref} className="py-2" data-testid={`evidence-guide-${r.ref}`}>
                <div className="flex flex-wrap items-center gap-2">
                  {r.status === "available" ? (
                    <Link href={r.route} className="font-medium text-foreground underline-offset-2 hover:underline">
                      {r.title}
                    </Link>
                  ) : (
                    <span className="font-medium text-muted-foreground">{r.title}</span>
                  )}
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{r.frequency}</span>
                  {r.status !== "available" && (
                    <Badge variant="secondary" className="text-[10px]">
                      {r.statusLabel ? `${r.statusLabel} · coming` : "coming"}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{r.purpose}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

const RENDERERS: Record<string, (ctx: Ctx) => ReactNode> = {
  "sales-summary": SalesSummary,
  "revenue-by-day": RevenueByDay,
  "revenue-by-category": RevenueByCategory,
  "payment-methods": PaymentMethods,
  "orders-by-hour": OrdersByHour,
  "top-products": TopProducts,
  "customer-mix": CustomerMix,
  "top-customers": TopCustomers,
  "stock-movement": StockMovement,
  "busiest-hours": BusiestHours,
  "order-channels": OrderChannels,
  "stock-turn": StockTurn,
  "customer-truths": CustomerTruths,
  "profit-truths": ProfitTruths,
  "evidence-guide": EvidenceGuide,
};

/** Grid spans: phones are always one column; `lg:` is a six-column grid. */
export const SIZE_CLASS = {
  small: "col-span-1 md:col-span-1 lg:col-span-2",
  medium: "col-span-1 md:col-span-1 lg:col-span-3",
  large: "col-span-1 md:col-span-2 lg:col-span-6",
} as const;

export function TruthsWidgetCard({ entry, isPhone, controls }: { entry: TruthsLayoutEntry; isPhone: boolean; controls?: ReactNode }) {
  const def = truthsWidget(entry.id);
  if (!def) return null;
  const ctx: Ctx = { window: entry.window, isPhone };
  const body = def.evidenceRef ? (
    <EvidenceWidget {...ctx} evidenceRef={def.evidenceRef} />
  ) : (
    RENDERERS[def.id]?.(ctx) ?? null
  );
  return (
    <section
      className={`lm-card flex min-w-0 flex-col rounded-xl p-4 ${SIZE_CLASS[entry.size]}`}
      data-testid={`truths-widget-${def.id}`}
      aria-label={def.label}
    >
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-tight text-foreground">{def.label}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground" data-testid={`truths-widget-window-${def.id}`}>
            Window: {TRUTHS_WINDOWS[entry.window]}
            {def.evidenceRef ? ` · ${def.evidenceRef}` : ""}
          </p>
        </div>
        <Link
          href={def.href}
          className="inline-flex min-h-[36px] items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </header>
      <div className="min-w-0 flex-1">{body}</div>
      {controls}
    </section>
  );
}
