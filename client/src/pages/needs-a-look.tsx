/**
 * Needs a look (v1.2 Phase 4, CMP-02): exceptions to review.
 *
 * A flagged sale (below the minimum or below cost) or a refund the refunds
 * rule picks out lands here as "open". A reviewer marks it acknowledged,
 * explained or escalated, with a note; escalating tells the people above them.
 * There is a queue per role — managers work through cashiers', admins through
 * managers' too, the owner sees everything — and nobody sees their own. The
 * server cuts the list the same way; this page only lays it out.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getJson, queryClient } from "@/lib/queryClient";
import { EXCEPTION_STATE_LABELS, EXCEPTION_STATES, type ExceptionState } from "@shared/review/exceptions";

type Item = {
  id: string;
  kind: "price" | "refund" | "pattern";
  orderId: string | null;
  orderRef: string | null;
  subjectName: string;
  subjectRole: string;
  severity: string;
  summary: string;
  amount: number | null;
  state: ExceptionState;
  reviewerName: string | null;
  note: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type Inbox = {
  queues: Array<{ role: string; label: string; open: number }>;
  stale: number;
  staleLine: string;
  items: Item[];
};

const KIND_LABEL = { price: "Price", refund: "Refund", pattern: "Pattern" } as const;

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function ReviewCard({ item }: { item: Item }) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const review = useMutation({
    mutationFn: async (state: ExceptionState) =>
      (await apiRequest("POST", `/api/needs-a-look/${item.id}/review`, { state, note: note.trim() || null })).json(),
    onSuccess: (_r, state) => {
      queryClient.invalidateQueries({ queryKey: ["/api/needs-a-look"] });
      toast({ title: `Marked ${EXCEPTION_STATE_LABELS[state].toLowerCase()}` });
      setNote("");
    },
    onError: (e: Error) => toast({ title: "Could not save the review", description: e.message, variant: "destructive" }),
  });

  return (
    <Card className="lm-card border-0 shadow-none" data-testid={`needs-a-look-item-${item.id}`}>
      <CardContent className="pt-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={item.severity === "error" ? "destructive" : "secondary"}>{KIND_LABEL[item.kind]}</Badge>
          <Badge variant="outline">{EXCEPTION_STATE_LABELS[item.state]}</Badge>
          <span className="text-sm font-medium">{item.subjectName}</span>
          <span className="text-xs text-muted-foreground">{when(item.createdAt)}</span>
        </div>
        <p className="text-sm">{item.summary}</p>
        {item.reviewerName && (
          <p className="text-xs text-muted-foreground">
            {EXCEPTION_STATE_LABELS[item.state]} by {item.reviewerName} · {when(item.reviewedAt)}
            {item.note ? ` · "${item.note}"` : ""}
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor={`note-${item.id}`} className="text-xs">
            Note (optional)
          </Label>
          <Textarea
            id={`note-${item.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            data-testid={`input-review-note-${item.id}`}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["acknowledged", "explained", "escalated"] as const).map((state) => (
            <Button
              key={state}
              size="sm"
              variant={state === "escalated" ? "destructive" : "outline"}
              className="min-h-[44px]"
              disabled={review.isPending || item.state === state}
              onClick={() => review.mutate(state)}
              data-testid={`button-review-${state}-${item.id}`}
            >
              {EXCEPTION_STATE_LABELS[state]}
            </Button>
          ))}
          {item.state !== "open" && (
            <Button size="sm" variant="ghost" className="min-h-[44px]" disabled={review.isPending} onClick={() => review.mutate("open")}>
              Reopen
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function NeedsALookPage() {
  const [state, setState] = useState<ExceptionState | "all">("open");
  const [queue, setQueue] = useState<string>("all");
  const [kind, setKind] = useState<string>("all");
  const params = new URLSearchParams({ state, ...(queue !== "all" ? { queue } : {}), ...(kind !== "all" ? { kind } : {}) }).toString();
  const { data, isLoading, isError } = useQuery<Inbox>({
    queryKey: ["/api/needs-a-look", params],
    queryFn: () => getJson(`/api/needs-a-look?${params}`),
  });

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <PageHeader
        icon={ClipboardList}
        title="Needs a look"
        question="Which flagged sales, refunds and patterns has nobody reviewed yet?"
        explanation="Sales below the minimum or below cost, refunds the refund rules pick out, and weekly patterns (3 or more events and at least twice the person's usual, or among the team's highest weeks). Nothing here was blocked, and a pattern is a question, not a finding. Mark each one acknowledged, explained or escalated; escalating tells the people above you."
      />

      {data && (
        <p className="text-sm font-medium" data-testid="text-needs-a-look-stale">
          {data.staleLine}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Queue</Label>
          <Select value={queue} onValueChange={setQueue}>
            <SelectTrigger className="w-[200px] min-h-[44px]" data-testid="select-needs-a-look-queue">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All my queues</SelectItem>
              {(data?.queues ?? []).map((q) => (
                <SelectItem key={q.role} value={q.role}>
                  {q.label} ({q.open} open)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">State</Label>
          <Select value={state} onValueChange={(v) => setState(v as ExceptionState | "all")}>
            <SelectTrigger className="w-[180px] min-h-[44px]" data-testid="select-needs-a-look-state">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXCEPTION_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {EXCEPTION_STATE_LABELS[s]}
                </SelectItem>
              ))}
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Kind</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-[160px] min-h-[44px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everything</SelectItem>
              <SelectItem value="price">Sales</SelectItem>
              <SelectItem value="refund">Refunds</SelectItem>
              <SelectItem value="pattern">Patterns</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isError && <p className="text-sm text-destructive">Could not load Needs a look. Try again.</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && data.items.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="text-needs-a-look-empty">
          Nothing to look at here.
        </p>
      )}
      <div className="space-y-3">
        {data?.items.map((item) => <ReviewCard key={item.id} item={item} />)}
      </div>
    </div>
  );
}
