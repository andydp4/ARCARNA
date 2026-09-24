import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LM_CARD } from "@/components/PageHeader";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  DELIVERY_FEE_MAX,
  DELIVERY_FEE_NAME_DEFAULT,
  DELIVERY_FEE_NAME_MAX,
  DELIVERY_FEE_PRICE_DEFAULT,
  readDeliveryFee,
} from "@shared/orders/deliveryFee";

type FeeSettings = { deliveryFeeName?: string; deliveryFeePrice?: number; deliveryFeeCommissionable?: boolean };

/**
 * The delivery fee (v1.2.1): its name and the price one tap adds at the till,
 * and whether it counts in commission and margin (off by default). Admins
 * only; every change is logged on the server.
 */
export function DeliveryFeeSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<FeeSettings>({ queryKey: ["/api/settings"] });
  const [name, setName] = useState(DELIVERY_FEE_NAME_DEFAULT);
  const [price, setPrice] = useState(DELIVERY_FEE_PRICE_DEFAULT.toFixed(2));

  useEffect(() => {
    if (!data) return;
    setName(data.deliveryFeeName ?? DELIVERY_FEE_NAME_DEFAULT);
    setPrice((data.deliveryFeePrice ?? DELIVERY_FEE_PRICE_DEFAULT).toFixed(2));
  }, [data?.deliveryFeeName, data?.deliveryFeePrice]);

  const save = useMutation({
    mutationFn: async (body: { name?: string; defaultPrice?: number; commissionable?: boolean }) =>
      (await apiRequest("PUT", "/api/settings/delivery-fee", body)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Delivery fee saved" });
    },
    onError: (e: Error) => toast({ title: "Could not save the delivery fee", description: e.message, variant: "destructive" }),
  });

  const priceCheck = readDeliveryFee(price, { fulfilmentMethod: "delivery" });
  const nameProblem = name.trim() ? null : "Give the fee a name.";
  const counted = data?.deliveryFeeCommissionable === true;

  return (
    <Card className={LM_CARD} data-testid="delivery-fee-settings">
      <CardHeader>
        <CardTitle>Delivery fee</CardTitle>
        <CardDescription>
          A charge on top of a delivery order, added at the till with one tap and changeable per order. It has no stock
          and no cost, is in the order total and takings, and shows on its own line on the receipt and invoice. Every
          change here is logged.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="delivery-fee-name">Name</Label>
            <Input
              id="delivery-fee-name"
              value={name}
              maxLength={DELIVERY_FEE_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-delivery-fee-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="delivery-fee-price">Price (£)</Label>
            <Input
              id="delivery-fee-price"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              aria-invalid={!priceCheck.ok}
              data-testid="input-delivery-fee-price"
            />
            <p className="text-xs text-muted-foreground">Up to £{DELIVERY_FEE_MAX.toFixed(2)}. VAT is added at the shop's rate.</p>
          </div>
        </div>
        {(nameProblem || !priceCheck.ok) && (
          <p className="text-sm text-destructive" role="alert">
            {nameProblem ?? (!priceCheck.ok ? priceCheck.message : "")}
          </p>
        )}
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => priceCheck.ok && save.mutate({ name: name.trim(), defaultPrice: priceCheck.fee })}
            disabled={!data || save.isPending || !!nameProblem || !priceCheck.ok}
            className="min-h-[44px]"
            data-testid="button-save-delivery-fee"
          >
            Save
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <Label htmlFor="delivery-fee-commission" className="text-sm">
            Count the delivery fee in commission and margin
            <span className="block text-xs font-normal text-muted-foreground">
              {counted
                ? "On: the fee earns commission and counts in gross profit."
                : "Off: the fee earns no commission and is left out of margin."}
            </span>
          </Label>
          <Switch
            id="delivery-fee-commission"
            checked={counted}
            disabled={!data || save.isPending}
            onCheckedChange={(v) => save.mutate({ commissionable: v })}
            data-testid="switch-delivery-fee-commission"
          />
        </div>
      </CardContent>
    </Card>
  );
}
