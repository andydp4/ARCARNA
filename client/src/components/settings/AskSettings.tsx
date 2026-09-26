import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircleQuestion } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LM_CARD } from "@/components/PageHeader";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AskLogRow, AskSettingsView } from "@shared/ask";

const gbp = (n: number, dp = 2) => `£${n.toFixed(dp)}`;

/**
 * Ask arcarna settings (v1.2): admins and the owner. Says plainly whether it
 * is set up (never shows the key) and, when not, which .env line to add. The
 * monthly spend cap and the dollar-to-pound rate are saved here, each change
 * logged; the recent questions show who asked what, scrubbed, never answers.
 */
export function AskSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useQuery<AskSettingsView>({ queryKey: ["/api/ask/settings"] });
  const { data: log } = useQuery<{ rows: AskLogRow[] }>({ queryKey: ["/api/ask/log"], enabled: !!data?.configured });
  const [cap, setCap] = useState("");
  const [rate, setRate] = useState("");

  useEffect(() => {
    if (!data) return;
    setCap(String(data.monthlyCapGbp));
    setRate(String(data.usdToGbp));
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/ask/settings", { monthlyCapGbp: Number(cap), usdToGbp: Number(rate) });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/ask/settings"] });
      toast({ title: "Saved", description: "Ask arcarna's monthly limit is updated." });
    },
    onError: (error: Error) => toast({ title: "Couldn't save", description: error.message, variant: "destructive" }),
  });

  if (!data) return null;
  return (
    <Card className={LM_CARD} data-testid="ask-settings">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <MessageCircleQuestion className="h-5 w-5" aria-hidden />
          Ask arcarna
          <Badge variant={data.configured ? "default" : "secondary"} data-testid="ask-status">
            {data.configured ? "Set up" : "Not set up"}
          </Badge>
        </CardTitle>
        <CardDescription>
          Staff ask questions in plain English and get answers from your own Evidence, read-only and only within their
          role. Questions go to Anthropic's Claude API ({data.model}); see docs/ask-arcarna-privacy.md. Hidden from staff
          until it is set up.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!data.configured && (
          <div className="space-y-2">
            <p>
              Add this line to the server's <code>.env</code> (a key from console.anthropic.com › API keys), then restart
              arcarna:
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs" data-testid="ask-env-lines">
              {data.envLines.join("\n")}
            </pre>
          </div>
        )}
        <p>
          This month (from {data.monthStart}): <strong>{gbp(data.spentThisMonthGbp)}</strong> of{" "}
          <strong>{gbp(data.monthlyCapGbp)}</strong> across {data.questionsThisMonth} question
          {data.questionsThisMonth === 1 ? "" : "s"}. Estimated from Claude's published price (${data.pricePerMTokUsd.input} in, $
          {data.pricePerMTokUsd.output} out per million tokens) at your rate below.
        </p>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="ask-cap">Monthly limit (£)</Label>
            <Input id="ask-cap" type="number" min={0} max={10000} step="0.01" value={cap} onChange={(e) => setCap(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ask-rate">US dollar to pound rate</Label>
            <Input id="ask-rate" type="number" min={0.1} max={5} step="0.0001" value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
          <Button type="submit" className="min-h-[44px]" disabled={save.isPending}>
            Save
          </Button>
        </form>
        <p className="text-muted-foreground">A limit of £0 pauses Ask arcarna. Each change is logged.</p>
        {log && log.rows.length > 0 && (
          <details className="rounded-md border border-border p-3">
            <summary className="cursor-pointer font-medium">Recent questions ({log.rows.length})</summary>
            <p className="mt-2 text-xs text-muted-foreground">
              Admins only. Phone numbers, emails, card numbers and postcodes are removed before a question is kept. Answers
              are never kept.
            </p>
            <ul className="mt-2 space-y-2">
              {log.rows.slice(0, 30).map((r) => (
                <li key={r.id} className="border-t border-border pt-2">
                  <p className="text-xs text-muted-foreground">
                    {new Date(r.askedAt).toLocaleString("en-GB")} · {r.name} ({r.role}) · {r.outcome} · {gbp(r.costGbp, 4)}
                  </p>
                  <p>{r.question || "(no question kept)"}</p>
                  {r.tools.length > 0 && <p className="text-xs text-muted-foreground">Used: {r.tools.join(", ")}</p>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
