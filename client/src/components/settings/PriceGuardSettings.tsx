import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LM_CARD } from "@/components/PageHeader";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * "Price guard at the till" (v1.2 Phase 4): admins only, off by default, and
 * every change is logged on the server. Until it is on, underpriced sales are
 * still recorded silently for "Would have flagged".
 */
export function PriceGuardSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<{ priceGuardEnabled?: boolean }>({ queryKey: ["/api/settings"] });
  const enabled = data?.priceGuardEnabled === true;
  const save = useMutation({
    mutationFn: async (next: boolean) => (await apiRequest("PUT", "/api/settings/price-guard", { enabled: next })).json(),
    onSuccess: (_res, next) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: next ? "Price guard is on" : "Price guard is off",
        description: next
          ? "The till now warns below the lowest price and asks for a reason at Pay."
          : "The till shows nothing; underpriced sales are still recorded silently.",
      });
    },
    onError: (e: Error) => toast({ title: "Could not change the price guard", description: e.message, variant: "destructive" }),
  });

  return (
    <Card className={LM_CARD} data-testid="price-guard-settings">
      <CardHeader>
        <CardTitle>Price guard at the till</CardTitle>
        <CardDescription>
          When on, a price below an item's lowest price shows one amber line, the cashier gives a reason at Pay, and
          managers get a Signal. Sales are never blocked. Every change to this switch is logged.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="price-guard-switch" className="text-sm">
            {enabled ? "On" : "Off: recording silently (Would have flagged)"}
          </Label>
          <Switch
            id="price-guard-switch"
            checked={enabled}
            disabled={!data || save.isPending}
            onCheckedChange={(v) => save.mutate(v)}
            data-testid="switch-price-guard"
          />
        </div>
      </CardContent>
    </Card>
  );
}
