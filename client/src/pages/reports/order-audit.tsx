/**
 * Order Audit: the full, timestamped story of one order — every stage, who
 * did it, the customer, the loyalty/promo boost, the payment split, and any
 * refund. The list below is a date-ranged search; picking a row opens its
 * full breakdown.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ScrollText } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getJson } from "@/lib/queryClient";
import { PERFORMANCE_PRESETS, presetRange, type PerformancePreset } from "@shared/reports/staffPerformance";
import { PRESET_LABEL, todayIso } from "./order-timing";

interface OrderAuditRow {
  id: string;
  shortCode: string;
  createdAt: string;
  status: string;
  channel: string;
  fulfilmentMethod: string;
  paymentMethod: string;
  total: number;
  customerName: string | null;
  enteredByName: string | null;
  completedByName: string | null;
}

interface OrderAuditDetail {
  order: {
    id: string;
    createdAt: string;
    settledAt: string | null;
    status: string;
    channel: string;
    fulfilmentMethod: string;
    paymentMethod: string;
    total: number;
    settledTotal: number | null;
    subtotal: number | null;
    tierDiscount: number | null;
    promoCode: string | null;
    promoDiscount: number | null;
    pointsRedeemed: number | null;
    pointsDiscount: number | null;
    vatAmount: number | null;
    deliveryFee: number | null;
    customerName: string | null;
    enteredByName: string | null;
    assignedToName: string | null;
    completedByName: string | null;
  };
  items: Array<{ productName: string | null; quantity: number; unitPrice: number; totalPrice: number }>;
  payments: Array<{ method: string; amount: number; status: string; paidAt: string | null }>;
  loyalty: Array<{ pointsDelta: number; reason: string; createdAt: string }>;
  refunds: Array<{ id: string; total: number; reason: string; createdAt: string; cashierName: string | null }>;
  timeline: Array<{ kind: string; at: string; actorName: string | null; station: string | null; meta: unknown }>;
}

function money(n: number | null): string {
  return n == null ? "—" : `£${n.toFixed(2)}`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const KIND_LABEL: Record<string, string> = {
  received: "Order received",
  assigned: "Assigned",
  unassigned: "Unassigned",
  ready: "Marked ready",
  unready: "Un-marked ready",
  arrived: "Customer arrived",
  out_for_delivery: "Out for delivery",
  held: "Put on hold",
  unheld: "Resumed",
  delayed: "Flagged delayed",
  delay_cleared: "Delay cleared",
  due_set: "Due time set",
  completed: "Completed",
  reopened: "Reopened",
  status_changed: "Status changed",
  deleted: "Deleted",
  edited: "Edited",
};

export default function OrderAuditReport() {
  const today = useMemo(todayIso, []);
  const [preset, setPreset] = useState<PerformancePreset | "custom">("today");
  const initial = presetRange("today", today);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const choosePreset = (p: string) => {
    setPreset(p as PerformancePreset | "custom");
    if (p !== "custom") {
      const r = presetRange(p as PerformancePreset, today);
      setFrom(r.from);
      setTo(r.to);
    }
  };

  const params = new URLSearchParams({ startDate: from, endDate: to }).toString();
  const { data, isLoading } = useQuery<OrderAuditRow[]>({
    queryKey: ["/api/reports/order-audit", params],
    queryFn: () => getJson(`/api/reports/order-audit?${params}`),
  });

  const detailQuery = useQuery<OrderAuditDetail>({
    queryKey: ["/api/reports/order-audit", openOrderId],
    queryFn: () => getJson(`/api/reports/order-audit/${openOrderId}`),
    enabled: !!openOrderId,
  });

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to Evidence
      </Link>
      <PageHeader
        title="Order Audit"
        icon={ScrollText}
        question="What exactly happened on this order, and who did each part of it?"
        explanation="Every stage timestamp, actor, payment leg, loyalty/promo boost and refund for one order, in one place."
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <Select value={preset} onValueChange={choosePreset}>
            <SelectTrigger className="w-40" data-testid="select-order-audit-preset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERFORMANCE_PRESETS.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRESET_LABEL[p]}
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          {preset === "custom" ? (
            <>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : !data || data.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No orders in this period.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Entered by</TableHead>
                  <TableHead>Completed by</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => setOpenOrderId(row.id)}
                    data-testid={`row-order-audit-${row.id}`}
                  >
                    <TableCell className="font-mono text-xs">{row.shortCode}</TableCell>
                    <TableCell>{when(row.createdAt)}</TableCell>
                    <TableCell>{row.customerName ?? "—"}</TableCell>
                    <TableCell>{row.enteredByName ?? "—"}</TableCell>
                    <TableCell>{row.completedByName ?? "—"}</TableCell>
                    <TableCell>{row.paymentMethod}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{money(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!openOrderId} onOpenChange={(open) => !open && setOpenOrderId(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Order {openOrderId?.slice(0, 8)}</DialogTitle>
          </DialogHeader>
          {detailQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !detailQuery.data ? (
            <p className="text-sm text-muted-foreground">Couldn't load this order.</p>
          ) : (
            <OrderAuditDetailView detail={detailQuery.data} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrderAuditDetailView({ detail }: { detail: OrderAuditDetail }) {
  const { order, items, payments, loyalty, refunds, timeline } = detail;
  return (
    <div className="space-y-5 text-sm">
      <section className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs text-muted-foreground">Customer</p>
          <p>{order.customerName ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Status</p>
          <p>{order.status}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Channel / fulfilment</p>
          <p>{order.channel} / {order.fulfilmentMethod}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Entered by</p>
          <p>{order.enteredByName ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Assigned to</p>
          <p>{order.assignedToName ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Completed by</p>
          <p>{order.completedByName ?? "—"}</p>
        </div>
      </section>

      <section>
        <p className="mb-1 font-medium">Items</p>
        <ul className="space-y-1">
          {items.map((i, idx) => (
            <li key={idx} className="flex justify-between">
              <span>{i.quantity} × {i.productName ?? "Unknown product"}</span>
              <span>{money(i.totalPrice)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs text-muted-foreground">Subtotal</p>
          <p>{money(order.subtotal)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">VAT</p>
          <p>{money(order.vatAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Tier discount</p>
          <p>{money(order.tierDiscount)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Promo</p>
          <p>{order.promoCode ? `${order.promoCode} (${money(order.promoDiscount)})` : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Points redeemed</p>
          <p>{order.pointsRedeemed ? `${order.pointsRedeemed} pts (${money(order.pointsDiscount)})` : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Delivery fee</p>
          <p>{money(order.deliveryFee)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="font-semibold">{money(order.total)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Settled total</p>
          <p>{money(order.settledTotal)}</p>
        </div>
      </section>

      {payments.length > 0 ? (
        <section>
          <p className="mb-1 font-medium">Payment</p>
          <ul className="space-y-1">
            {payments.map((p, idx) => (
              <li key={idx} className="flex justify-between">
                <span>{p.method} ({p.status})</span>
                <span>{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loyalty.length > 0 ? (
        <section>
          <p className="mb-1 font-medium">Loyalty points</p>
          <ul className="space-y-1">
            {loyalty.map((l, idx) => (
              <li key={idx} className="flex justify-between">
                <span>{l.reason}</span>
                <span>{l.pointsDelta > 0 ? "+" : ""}{l.pointsDelta} pts</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {refunds.length > 0 ? (
        <section>
          <p className="mb-1 font-medium">Refunds</p>
          <ul className="space-y-1">
            {refunds.map((r) => (
              <li key={r.id} className="flex justify-between">
                <span>{r.reason} — {r.cashierName ?? "—"}</span>
                <span>{money(r.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <p className="mb-1 font-medium">Timeline</p>
        <ol className="space-y-1.5 border-l border-border pl-3">
          {timeline.map((e, idx) => (
            <li key={idx}>
              <p className="text-sm">{KIND_LABEL[e.kind] ?? e.kind}</p>
              <p className="text-xs text-muted-foreground">
                {when(e.at)} · {e.actorName ?? "System"}
                {e.station ? ` · ${e.station}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
