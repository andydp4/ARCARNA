import { useState } from "react";
import { Loader2, MapPin, Phone } from "lucide-react";
import { apiFetch } from "@/lib/appPaths";
import { Button } from "@/components/ui/button";
import { canSeeContactDetails, driverCallVerdict } from "@shared/accessPolicy";
import type { BoardOrder } from "@/lib/orderTypes";

/**
 * Where a delivery goes, and the driver's call (v1.2 Phase 5, owner decision
 * Q8a). The board carries no phone: the person the delivery is assigned to
 * asks for it once it is out for delivery, and each ask is logged by the
 * server. The number is held in this component's state only — never in the
 * query cache, local storage or the service worker — and is gone when the
 * panel closes.
 */
export function OpsCustomerCall({
  order,
  role,
  currentUserId,
}: {
  order: BoardOrder;
  role?: string;
  currentUserId?: string | null;
}) {
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const mayCall =
    Boolean(order.customerId) &&
    (canSeeContactDetails(role) || driverCallVerdict(role, currentUserId ?? null, order).ok);

  const reveal = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/orders/${order.id}/customer-phone`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? "Could not show the number");
      setPhone(body.phone as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not show the number");
    } finally {
      setLoading(false);
    }
  };

  const hasAddress = order.fulfilmentMethod === "delivery" && (order.deliveryAddress || order.deliveryPostcode);

  if (!hasAddress && !mayCall) return null;

  return (
    <div className="mt-3 space-y-2" data-testid="ops-delivery-details">
      {hasAddress && (
        <p className="flex items-start gap-2 text-sm text-foreground">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            {[order.deliveryAddress, order.deliveryPostcode].filter(Boolean).join(", ")}
            {order.deliveryNotes && <span className="block text-muted-foreground">{order.deliveryNotes}</span>}
          </span>
        </p>
      )}
      {mayCall &&
        (phone ? (
          <Button asChild variant="outline" size="touch" data-testid="button-call-customer">
            <a href={`tel:${phone}`}>
              <Phone className="h-4 w-4" aria-hidden />
              {phone}
            </a>
          </Button>
        ) : (
          <Button variant="outline" size="touch" onClick={reveal} disabled={loading} data-testid="button-show-customer-phone">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Phone className="h-4 w-4" aria-hidden />}
            Show number to call
          </Button>
        ))}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
