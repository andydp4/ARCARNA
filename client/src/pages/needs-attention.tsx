/**
 * Needs attention (v1.2 Phase 1A): till sales arcarna refused.
 *
 * A sale kept on a till while the connection was down can be refused when it
 * is finally sent — a customer removed, a split that no longer adds up. The
 * till hands it here rather than retrying it for ever or losing it on
 * sign-out, and a manager decides: Retry (send it as it was), Edit (open it
 * in the till and fix it), Export (download it), or Discard (with a reason,
 * logged with the whole sale). Every resend keeps the sale's own reference,
 * so it can never be recorded twice.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, Pencil, RotateCw, Send, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { sendSale } from "@/lib/saleQueue";
import { saleIssueLinesTotal, readSaleIssuePayload, stashSaleIssueDraft } from "@/lib/saleIssueDraft";
import { useSaleQueueStatus } from "@/hooks/useSaleQueueStatus";
import { syncService } from "@/lib/sync-service";
import { formatSaleQueueStatus } from "@shared/orders/saleReference";

export interface SaleIssueRow {
  id: string;
  clientOrderId: string;
  locationId: string | null;
  rungByUserId: string;
  rungByName: string | null;
  payload: Record<string, unknown>;
  reason: string;
  httpStatus: number | null;
  queuedAt: string | null;
  reportedAt: string;
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function IssueCard({
  issue,
  productName,
  customerName,
}: {
  issue: SaleIssueRow;
  productName: (id: string) => string;
  customerName: (id: string) => string | null;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardReason, setDiscardReason] = useState("");
  const sale = readSaleIssuePayload(issue.payload);
  const total = saleIssueLinesTotal(issue.payload);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/sale-issues"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/sale-issues/summary"] });
  };

  const retry = useMutation({
    mutationFn: async () => {
      const outcome = await sendSale({
        ...issue.payload,
        clientOrderId: issue.clientOrderId,
        saleIssueId: issue.id,
        saleIssueMode: "retry",
      });
      if (outcome.ok) return outcome.body;
      throw new Error(
        outcome.status === null
          ? "arcarna did not answer. Press Retry again — the sale can only be recorded once."
          : outcome.message,
      );
    },
    onSuccess: (body: { duplicate?: boolean }) => {
      toast({
        title: "Sale recorded",
        description: body?.duplicate ? "It had already been recorded; nothing was added twice." : "It is now in the day's sales.",
      });
      refresh();
    },
    onError: (error: Error) => {
      toast({ title: "Still refused", description: error.message, variant: "destructive" });
      refresh();
    },
  });

  const discard = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/sale-issues/${issue.id}/discard`, { reason: discardReason.trim() });
    },
    onSuccess: () => {
      toast({ title: "Sale discarded", description: "It was logged with who discarded it and why." });
      setDiscardOpen(false);
      refresh();
    },
    onError: (error: Error) => {
      toast({ title: "Could not discard", description: error.message, variant: "destructive" });
    },
  });

  const edit = () => {
    stashSaleIssueDraft({
      issueId: issue.id,
      clientOrderId: issue.clientOrderId,
      rungByName: issue.rungByName,
      payload: issue.payload,
    });
    navigate("/create-order");
  };

  const busy = retry.isPending || discard.isPending;
  const customer = sale.customerId ? customerName(sale.customerId) : null;

  return (
    <Card data-testid={`sale-issue-${issue.id}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
          <span>
            £{total.toFixed(2)} · {sale.payments && sale.payments.length > 1 ? "split" : sale.paymentMethod ?? "—"}
            {customer ? ` · ${customer}` : ""}
          </span>
          <span className="text-xs font-normal text-muted-foreground">Ref {issue.clientOrderId.slice(0, 8)}</span>
        </CardTitle>
        <CardDescription>
          Rung by {issue.rungByName ?? "someone no longer on the team"} · {when(issue.queuedAt ?? issue.reportedAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-md border border-border px-3 py-2 text-sm" data-testid="sale-issue-reason">
          <span className="font-medium">Why it was refused: </span>
          {issue.reason}
        </p>
        <ul className="text-sm text-muted-foreground">
          {sale.lines.map((line, i) => (
            <li key={`${line.productId}-${i}`}>
              {line.quantity} × {productName(line.productId)} at £{line.unitPrice.toFixed(2)}
            </li>
          ))}
        </ul>
        {sale.dropped.length > 0 && (
          <p className="text-xs text-muted-foreground">
            This sale also used {sale.dropped.join(" and ")}; a retry applies it again as sent.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => retry.mutate()} disabled={busy} data-testid="sale-issue-retry">
            <RotateCw className="mr-1 h-4 w-4" /> Retry
          </Button>
          <Button size="sm" variant="outline" onClick={edit} disabled={busy} data-testid="sale-issue-edit">
            <Pencil className="mr-1 h-4 w-4" /> Edit in the till
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadJson(`sale-${issue.clientOrderId.slice(0, 8)}.json`, issue)}
            data-testid="sale-issue-export"
          >
            <Download className="mr-1 h-4 w-4" /> Export
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDiscardOpen((open) => !open)}
            disabled={busy}
            data-testid="sale-issue-discard"
          >
            <Trash2 className="mr-1 h-4 w-4" /> Discard
          </Button>
        </div>
        {discardOpen && (
          <div className="space-y-2 rounded-md border border-border p-3" data-testid="sale-issue-discard-panel">
            <Label htmlFor={`discard-${issue.id}`}>Why is this sale being discarded?</Label>
            <Input
              id={`discard-${issue.id}`}
              value={discardReason}
              onChange={(e) => setDiscardReason(e.target.value)}
              placeholder="e.g. keyed in again by hand"
              data-testid="sale-issue-discard-reason"
            />
            <p className="text-xs text-muted-foreground">
              The sale will not be recorded. Your name, the reason and the whole sale are kept in the log.
            </p>
            <Button
              size="sm"
              variant="destructive"
              disabled={discardReason.trim().length < 3 || busy}
              onClick={() => discard.mutate()}
              data-testid="sale-issue-discard-confirm"
            >
              Discard this sale
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function NeedsAttention() {
  const { data, isLoading, error } = useQuery<{ issues: SaleIssueRow[] }>({
    queryKey: ["/api/sale-issues"],
    refetchInterval: 60_000,
  });
  const { data: products = [] } = useQuery<Array<{ id: string; name: string }>>({ queryKey: ["/api/products"] });
  const { data: customers = [] } = useQuery<Array<{ id: string; name: string }>>({ queryKey: ["/api/customers"] });
  const productNames = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);
  const customerNames = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);
  const local = useSaleQueueStatus();
  const [sending, setSending] = useState(false);
  const issues = data?.issues ?? [];

  return (
    <div className="w-full">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          icon={AlertTriangle}
          eyebrow="Sell"
          title="Needs attention"
          question="Which till sales did arcarna refuse, and what should happen to them?"
          explanation="Retry sends a sale as it was. Edit opens it in the till to fix. Nothing here is in the day's sales until it is recorded, and a sale is only ever recorded once."
        />

        {local.waiting + local.localFailed > 0 && (
          <Card className="mb-6" data-testid="needs-attention-this-till">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
              <span>
                This till: {formatSaleQueueStatus(local.waiting, local.localFailed)} — not reached arcarna yet.
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={sending || !navigator.onLine}
                onClick={async () => {
                  setSending(true);
                  try {
                    await syncService.syncOnline({ force: true });
                  } finally {
                    setSending(false);
                    void queryClient.invalidateQueries({ queryKey: ["/api/sale-issues"] });
                  }
                }}
                data-testid="needs-attention-send-now"
              >
                <Send className="mr-1 h-4 w-4" /> Send now
              </Button>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive">Could not load Needs attention. {(error as Error).message}</p>
        ) : issues.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground" data-testid="needs-attention-empty">
              Nothing needs attention. Every till sale has been recorded.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {issues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                productName={(id) => productNames.get(id) ?? "a product no longer in the catalogue"}
                customerName={(id) => customerNames.get(id) ?? null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
