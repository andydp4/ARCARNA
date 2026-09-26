import { useEffect, useState } from "react";
import { Loader2, MapPin, Pencil, Phone } from "lucide-react";
import { apiFetch } from "@/lib/appPaths";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DELIVERY_ADDRESS_MAX, DELIVERY_NOTES_MAX, DELIVERY_POSTCODE_MAX } from "@shared/orders/delivery";
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

  // The number belongs to this order while this person may call it: drop it
  // when the panel moves to another order or the delivery is completed, so it
  // is never shown outside "assignee, out for delivery, until completed".
  useEffect(() => {
    setPhone(null);
    setError(null);
  }, [order.id, mayCall]);

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
  // A live delivery's address can be put right from here (PATCH
  // /api/orders/:id/delivery, logged): a mistyped house number otherwise
  // sends the driver to the wrong door with no way to fix it.
  const canCorrect = order.fulfilmentMethod === "delivery" && order.status !== "completed";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ address: "", postcode: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const startEditing = () => {
    setDraft({
      address: order.deliveryAddress ?? "",
      postcode: order.deliveryPostcode ?? "",
      notes: order.deliveryNotes ?? "",
    });
    setError(null);
    setEditing(true);
  };

  const saveAddress = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/orders/${order.id}/delivery`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryAddress: draft.address,
          deliveryPostcode: draft.postcode,
          deliveryNotes: draft.notes,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? "Could not change the address");
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/orders/board"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the address");
    } finally {
      setSaving(false);
    }
  };

  if (!hasAddress && !mayCall && !canCorrect && !order.deliveryIssue) return null;

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
      {order.deliveryIssue && (
        // My run's "Couldn't deliver": why the last attempt failed.
        <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="ops-delivery-issue">
          {order.deliveryIssue}
          {order.deliveryIssueAt
            ? ` (${new Date(order.deliveryIssueAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })})`
            : ""}
        </p>
      )}
      {canCorrect && !editing && (
        <Button type="button" variant="ghost" size="sm" onClick={startEditing} data-testid="button-change-delivery-address">
          <Pencil className="h-4 w-4" aria-hidden />
          {hasAddress ? "Change address" : "Add address"}
        </Button>
      )}
      {canCorrect && editing && (
        <form
          className="space-y-2 rounded-md border border-border p-2"
          data-testid="form-change-delivery-address"
          onSubmit={(e) => {
            e.preventDefault();
            void saveAddress();
          }}
        >
          <div>
            <Label htmlFor={`ops-delivery-address-${order.id}`}>Address</Label>
            <Textarea
              id={`ops-delivery-address-${order.id}`}
              rows={2}
              maxLength={DELIVERY_ADDRESS_MAX}
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={`ops-delivery-postcode-${order.id}`}>Postcode</Label>
            <Input
              id={`ops-delivery-postcode-${order.id}`}
              maxLength={DELIVERY_POSTCODE_MAX}
              value={draft.postcode}
              onChange={(e) => setDraft({ ...draft, postcode: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={`ops-delivery-notes-${order.id}`}>Notes</Label>
            <Input
              id={`ops-delivery-notes-${order.id}`}
              maxLength={DELIVERY_NOTES_MAX}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving} data-testid="button-save-delivery-address">
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Save address
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
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
