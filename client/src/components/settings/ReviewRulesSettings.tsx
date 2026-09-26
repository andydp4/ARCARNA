import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { LM_CARD } from "@/components/PageHeader";
import { apiRequest, getJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { REVIEW_RULE_DEFAULTS, type ReviewRules } from "@shared/review/exceptions";

/**
 * The rules behind Signals and Needs a look (v1.2 Phase 4, PRC-04, CMP-04):
 * admins only, every change logged on the server.
 *  - Below-minimum Signals: straight away, or a round-up twice a day (12:00
 *    and 18:00). Below cost always goes straight away.
 *  - Refunds that raise an exception: cash over £X, N days or more after the
 *    sale (plus another cashier's sale and reason "Other", always).
 *  - Price overrides Evidence counts refunds by the same cashier within N hours.
 */
export function ReviewRulesSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<ReviewRules>({
    queryKey: ["/api/settings/review-rules"],
    queryFn: () => getJson("/api/settings/review-rules"),
  });
  const [form, setForm] = useState({
    priceGuardMinSignal: REVIEW_RULE_DEFAULTS.priceGuardMinSignal as string,
    refundCashOver: String(REVIEW_RULE_DEFAULTS.refundCashOver),
    refundAfterDays: String(REVIEW_RULE_DEFAULTS.refundAfterDays),
    refundSameCashierHours: String(REVIEW_RULE_DEFAULTS.refundSameCashierHours),
  });
  useEffect(() => {
    if (!data) return;
    setForm({
      priceGuardMinSignal: data.priceGuardMinSignal,
      refundCashOver: data.refundCashOver.toFixed(2),
      refundAfterDays: String(data.refundAfterDays),
      refundSameCashierHours: String(data.refundSameCashierHours),
    });
  }, [data]);

  const save = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("PUT", "/api/settings/review-rules", {
          priceGuardMinSignal: form.priceGuardMinSignal,
          refundCashOver: Number(form.refundCashOver),
          refundAfterDays: Math.round(Number(form.refundAfterDays)),
          refundSameCashierHours: Math.round(Number(form.refundSameCashierHours)),
        })
      ).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/review-rules"] });
      toast({ title: "Rules saved" });
    },
    onError: (e: Error) => toast({ title: "Could not save the rules", description: e.message, variant: "destructive" }),
  });

  return (
    <Card className={LM_CARD} data-testid="review-rules-settings">
      <CardHeader>
        <CardTitle>Signals and refund rules</CardTitle>
        <CardDescription>
          When managers hear about sales below the minimum, and which refunds go to Needs a look. Refunds are never
          blocked. Every change is logged.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label className="text-sm">Below-minimum Signals</Label>
          <RadioGroup
            value={form.priceGuardMinSignal}
            onValueChange={(v) => setForm({ ...form, priceGuardMinSignal: v })}
            className="space-y-1"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="immediate" id="min-signal-immediate" data-testid="radio-min-signal-immediate" />
              <Label htmlFor="min-signal-immediate" className="font-normal">Straight away</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="twice_daily" id="min-signal-twice" data-testid="radio-min-signal-twice-daily" />
              <Label htmlFor="min-signal-twice" className="font-normal">Twice a day (12:00 and 18:00)</Label>
            </div>
          </RadioGroup>
          <p className="text-xs text-muted-foreground">Below cost always goes straight away.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="refund-cash-over">Cash refund over (£)</Label>
            <Input
              id="refund-cash-over"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={form.refundCashOver}
              onChange={(e) => setForm({ ...form, refundCashOver: e.target.value })}
              className="min-h-[44px]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="refund-after-days">Refund after (days)</Label>
            <Input
              id="refund-after-days"
              type="number"
              min={1}
              step="1"
              inputMode="numeric"
              value={form.refundAfterDays}
              onChange={(e) => setForm({ ...form, refundAfterDays: e.target.value })}
              className="min-h-[44px]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="refund-same-hours">Same-cashier refund window (hours)</Label>
            <Input
              id="refund-same-hours"
              type="number"
              min={1}
              step="1"
              inputMode="numeric"
              value={form.refundSameCashierHours}
              onChange={(e) => setForm({ ...form, refundSameCashierHours: e.target.value })}
              className="min-h-[44px]"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Refunds on another cashier's sale and refunds with reason "Other" always go to Needs a look.
        </p>
        <Button onClick={() => save.mutate()} disabled={!data || save.isPending} className="min-h-[44px]" data-testid="button-save-review-rules">
          Save rules
        </Button>
      </CardContent>
    </Card>
  );
}
