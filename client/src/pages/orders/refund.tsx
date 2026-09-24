import { useState, useMemo } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { REFUND_REASONS, REFUND_METHODS } from "@shared/schema";
import { ArrowLeft } from "lucide-react";

interface OrderLine {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  total: string;
}

interface OrderDetail {
  id: string;
  customerName: string;
  total: string;
  settledTotal?: string | null;
  paymentMethod: string;
  refundedTotal?: number;
  items: OrderLine[];
  refunds?: Array<{ lines: Array<{ orderLineId: string; qty: number }> }>;
}

const METHOD_LABELS: Record<string, string> = {
  original: "The way it was paid",
  cash: "Cash",
  card: "Back to the card",
  store_credit: "Store credit",
};

const REASON_LABELS: Record<string, string> = {
  damaged: "Damaged",
  wrong_item: "Wrong item",
  customer_changed_mind: "Customer changed mind",
  defect: "Defect",
  other: "Other",
};

export default function OrderRefundPage() {
  const [, params] = useRoute("/open-orders/:id/refund");
  const orderId = params?.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<string>(REFUND_REASONS[0]);
  const [refundMethod, setRefundMethod] = useState<string>("original");
  const [notes, setNotes] = useState("");

  const { data: order, isLoading } = useQuery<OrderDetail>({
    queryKey: ["/api/orders", orderId],
    queryFn: async () => {
      const res = await apiFetch(`/api/orders/${orderId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Order not found");
      return res.json();
    },
    enabled: !!orderId,
  });

  const alreadyRefunded = useMemo(() => {
    const map = new Map<string, number>();
    for (const refund of order?.refunds ?? []) {
      for (const line of refund.lines ?? []) {
        map.set(
          line.orderLineId,
          (map.get(line.orderLineId) ?? 0) + line.qty,
        );
      }
    }
    return map;
  }, [order?.refunds]);

  const lines = useMemo(() => {
    if (!order) return [];
    return order.items.map((item) => {
      const refunded = alreadyRefunded.get(item.id) ?? 0;
      const remaining = item.quantity - refunded;
      return { ...item, refunded, remaining };
    });
  }, [order, alreadyRefunded]);

  // A refund gives back what the customer paid for the items: the sale's
  // settled total shared across its lines, so a discount comes off it too.
  // The server works out the final figure the same way.
  const refundTotal = useMemo(() => {
    const lineValue = lines.reduce((sum, line) => sum + line.quantity * parseFloat(line.unitPrice), 0);
    const settled = parseFloat(String(order?.settledTotal ?? order?.total ?? lineValue));
    const ratio = lineValue > 0 && Number.isFinite(settled) ? settled / lineValue : 1;
    const listValue = lines.reduce((sum, line) => {
      const qty = selected[line.id] ?? 0;
      return sum + qty * parseFloat(line.unitPrice);
    }, 0);
    return Math.round(listValue * ratio * 100) / 100;
  }, [lines, selected, order?.settledTotal, order?.total]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const refundLines = Object.entries(selected)
        .filter(([, qty]) => qty > 0)
        .map(([orderLineId, qty]) => ({ orderLineId, qty }));
      const res = await apiRequest("POST", `/api/orders/${orderId}/refunds`, {
        reason,
        refundMethod,
        notes: notes.trim() || undefined,
        lines: refundLines,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      toast({ title: "Refund issued" });
      // ARC-048: `history.back()` left the SPA entirely when this page was
      // opened directly (a bookmark or shared link) rather than clicked
      // through from Open Orders, since there was no app history to go back
      // to. Navigate explicitly instead — same destination the "Back to
      // orders" link above already goes, so it works identically whether the
      // page had history or not.
      setLocation("/operations");
    },
    onError: (err: Error) => {
      toast({
        title: "Refund failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (!orderId) {
    return <p className="p-6 text-muted-foreground">Invalid order</p>;
  }

  if (isLoading || !order) {
    return <p className="p-6 text-muted-foreground">Loading order…</p>;
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Link href="/operations">
        <Button variant="ghost" size="sm" className="mb-2">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to orders
        </Button>
      </Link>

      <PageHeader
        title="Issue refund"
        question="What are we refunding, and why?"
        explanation={`Order ${order.id.slice(0, 8)} · ${order.customerName}`}
      />

      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select lines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {lines.map((line) => (
              <div
                key={line.id}
                className="flex items-center justify-between gap-4 border-b pb-3 last:border-0"
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={(selected[line.id] ?? 0) > 0}
                    disabled={line.remaining <= 0}
                    onCheckedChange={(checked) => {
                      setSelected((s) => ({
                        ...s,
                        [line.id]: checked ? Math.min(1, line.remaining) : 0,
                      }));
                    }}
                  />
                  <div>
                    <p className="font-medium">{line.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      £{parseFloat(line.unitPrice).toFixed(2)} each · {line.remaining}{" "}
                      refundable
                    </p>
                  </div>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={line.remaining}
                  className="w-20"
                  disabled={line.remaining <= 0}
                  value={selected[line.id] ?? ""}
                  onChange={(e) => {
                    const qty = Math.min(
                      line.remaining,
                      Math.max(0, parseInt(e.target.value, 10) || 0),
                    );
                    setSelected((s) => ({ ...s, [line.id]: qty }));
                  }}
                />
              </div>
            ))}
            <p className="text-sm font-medium">Refund total: £{refundTotal.toFixed(2)}</p>
            <Button
              className="w-full"
              disabled={refundTotal <= 0}
              onClick={() => setStep(1)}
            >
              Continue
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reason & method</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REFUND_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {REASON_LABELS[r] ?? r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Refund method</Label>
              <Select value={refundMethod} onValueChange={setRefundMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REFUND_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {METHOD_LABELS[m] ?? m.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="refund-notes">{reason === "other" ? "Notes (say what the reason is)" : "Notes"}</Label>
              <Textarea id="refund-notes" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-refund-notes" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(0)}>
                Back
              </Button>
              {/* "Other" needs a word on what it was; the server checks too. */}
              <Button onClick={() => setStep(2)} disabled={reason === "other" && !notes.trim()}>Review</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Confirm refund</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">
              Refund <strong>£{refundTotal.toFixed(2)}</strong> via{" "}
              <strong>{METHOD_LABELS[refundMethod] ?? refundMethod}</strong> — {REASON_LABELS[reason]}.
            </p>
            <p className="text-xs text-muted-foreground">
              A sale on the Credit List is taken off the customer&apos;s tab first; only what they have paid is handed back.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
              >
                Confirm refund
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
