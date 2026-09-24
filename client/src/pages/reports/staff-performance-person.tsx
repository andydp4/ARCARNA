/**
 * Staff Performance drill-down (v1.2 Phase 7B): one person's 8-week trend and
 * their orders in the chosen dates. Customers appear by name only — never a
 * phone or an email (PRV-03). The server refuses a manager another manager's
 * drill-down (Q14); on a phone the two parts are tabs.
 */
import { Link, useParams, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, UserCheck } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getJson } from "@/lib/queryClient";
import { CHART_PRIMARY } from "@/lib/chartColors";
import type { PerformanceFigures } from "@shared/reports/staffPerformance";
import { money, ProvisionalNote } from "./staff-performance";

type Detail = {
  person: { userId: string; name: string; role: string };
  period: { from: string; to: string };
  provisional: boolean;
  provisionalUntil: string;
  figures: PerformanceFigures;
  trend: Array<{ weekStart: string; weekEnd: string; completed: number; salesCompleted: number; valueBroughtIn: number; loaded: number; prepared: number }>;
  orders: Array<{
    orderId: string;
    ref: string;
    settledAt: string;
    fulfilment: "collection" | "delivery";
    channel: string;
    value: number;
    jobs: string[];
    valueBroughtIn: number;
    customerName: string | null;
  }>;
  ordersTruncated: boolean;
};

const ROLE_LABEL: Record<string, string> = { CASHIER: "Cashier", MANAGER: "Manager", ADMIN: "Admin", SUPER_ADMIN: "Owner" };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

export default function StaffPerformancePerson() {
  const { userId } = useParams<{ userId: string }>();
  const search = useSearch();
  const id = decodeURIComponent(userId ?? "");
  const { data, isLoading, error } = useQuery<Detail>({
    queryKey: ["/api/evidence/staff-performance", id, search],
    queryFn: () => getJson(`/api/evidence/staff-performance/${encodeURIComponent(id)}?${search}`),
    retry: false,
  });
  const f = data?.figures;

  const trend = (
    <Card className="lm-card border-0 shadow-none">
      <CardHeader>
        <CardTitle>8-week trend</CardTitle>
        <CardDescription>Value brought in each week, Monday to Sunday, ending with the week of the last day you picked.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64" data-testid="chart-performance-trend">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.trend ?? []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="weekStart" tickFormatter={(d: string) => d.slice(5)} fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v: number) => `£${v}`} />
              <Tooltip formatter={(v: number) => money(v)} labelFormatter={(d: string) => `Week of ${d}`} />
              <Bar dataKey="valueBroughtIn" name="Value brought in" fill={CHART_PRIMARY} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Week of</TableHead>
                <TableHead className="text-right">Loaded</TableHead>
                <TableHead className="text-right">Prepared</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Sales completed</TableHead>
                <TableHead className="text-right">Value brought in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.trend ?? []).map((w) => (
                <TableRow key={w.weekStart}>
                  <TableCell>{w.weekStart}</TableCell>
                  <TableCell className="text-right">{w.loaded}</TableCell>
                  <TableCell className="text-right">{w.prepared}</TableCell>
                  <TableCell className="text-right">{w.completed}</TableCell>
                  <TableCell className="text-right">{money(w.salesCompleted)}</TableCell>
                  <TableCell className="text-right">{money(w.valueBroughtIn)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );

  const orders = (
    <Card className="lm-card border-0 shadow-none">
      <CardHeader>
        <CardTitle>Orders</CardTitle>
        <CardDescription>
          Counted orders they loaded, prepared, completed or dispatched in these dates, newest first. Customers by name only.
          {data?.ordersTruncated && " Showing the newest 500."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!data || data.orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders in these dates.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table data-testid="table-performance-orders">
              <TableHeader>
                <TableRow>
                  <TableHead>Settled</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>How</TableHead>
                  <TableHead>Their jobs</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Brought in</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.orders.map((o) => (
                  <TableRow key={o.orderId}>
                    <TableCell className="whitespace-nowrap">{new Date(o.settledAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</TableCell>
                    <TableCell className="font-mono text-xs">{o.ref}</TableCell>
                    <TableCell>{o.customerName ?? "—"}</TableCell>
                    <TableCell>{o.fulfilment === "delivery" ? "Delivery" : "Collection"} · {o.channel}</TableCell>
                    <TableCell>{o.jobs.join(", ")}</TableCell>
                    <TableCell className="text-right">{money(o.value)}</TableCell>
                    <TableCell className="text-right">{money(o.valueBroughtIn)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Link href={`/reports/staff-performance`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Staff Performance
      </Link>
      <PageHeader
        icon={UserCheck}
        title={data?.person.name ?? "Staff Performance"}
        question={data ? `${ROLE_LABEL[data.person.role] ?? data.person.role} · ${data.period.from} to ${data.period.to}` : undefined}
        explanation="Their own figures, the last eight weeks, and the orders behind them."
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{(error as Error).message || "You cannot see this person's figures."}</p>}
      {data?.provisional && <ProvisionalNote until={data.provisionalUntil} />}

      {f && (
        <Card className="lm-card border-0 shadow-none">
          <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
            <Stat label="Completed" value={`${f.completed} (${f.collected} collected, ${f.delivered} delivered)`} />
            <Stat label="Loaded · Prepared · Dispatched" value={`${f.loaded} · ${f.prepared} · ${f.dispatched}`} />
            <Stat label="Sales completed" value={money(f.salesCompleted)} />
            <Stat label="Value brought in" value={money(f.valueBroughtIn)} />
            <Stat label="Solo · Still open" value={`${f.solo} · ${f.stillOpen}`} />
            <Stat label="Average order" value={f.averageOrderValue == null ? "—" : money(f.averageOrderValue)} />
            <Stat label="Wrong item" value={f.wrongItemRatePercent == null ? "—" : `${f.wrongItemRatePercent.toFixed(1)}%`} />
            <Stat label="Reopens · Refunds · Deletes" value={`${f.reopens} · ${f.refundsProcessed} · ${f.deletes}`} />
          </CardContent>
        </Card>
      )}

      {data && (
        <Tabs defaultValue="trend">
          <TabsList>
            <TabsTrigger value="trend" data-testid="tab-person-trend">Trend</TabsTrigger>
            <TabsTrigger value="orders" data-testid="tab-person-orders">
              Orders <Badge variant="secondary" className="ml-2">{data.orders.length}</Badge>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="trend">{trend}</TabsContent>
          <TabsContent value="orders">{orders}</TabsContent>
        </Tabs>
      )}
    </div>
  );
}
