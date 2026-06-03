import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Award, ArrowLeft } from "lucide-react";

type LoyaltySettingsResponse = {
  redemptionRate: number;
  minRedeemPoints: number;
};

export default function LoyaltySettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rate, setRate] = useState("0.01");
  const [minPoints, setMinPoints] = useState("100");

  const { data, isLoading } = useQuery<LoyaltySettingsResponse>({
    queryKey: ["/api/loyalty/settings"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  useEffect(() => {
    if (data) {
      setRate(String(data.redemptionRate));
      setMinPoints(String(data.minRedeemPoints));
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/loyalty/settings", {
        redemptionRate: parseFloat(rate),
        minRedeemPoints: parseInt(minPoints, 10),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loyalty/settings"] });
      toast({ title: "Loyalty settings saved" });
    },
    onError: () => {
      toast({ title: "Failed to save settings", variant: "destructive" });
    },
  });

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Settings
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5" />
            Loyalty redemption
          </CardTitle>
          <CardDescription>
            Configure how customers redeem points at the POS. Default: 100 points = £1.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="redemption-rate">Redemption rate (£ per point)</Label>
                <Input
                  id="redemption-rate"
                  type="number"
                  step="0.001"
                  min="0.001"
                  max="1"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  0.01 means 100 points → £1.00 discount
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="min-redeem">Minimum points to redeem</Label>
                <Input
                  id="min-redeem"
                  type="number"
                  min="1"
                  step="1"
                  value={minPoints}
                  onChange={(e) => setMinPoints(e.target.value)}
                />
              </div>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                Save settings
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
