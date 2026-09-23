import { useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { apiFetch } from "@/lib/appPaths";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DELIVERY_ADDRESS_MAX,
  DELIVERY_NOTES_MAX,
  DELIVERY_POSTCODE_MAX,
} from "@shared/orders/delivery";

export type PosDeliveryState = {
  address: string;
  postcode: string;
  notes: string;
  /** "Save as their address" — starts unticked (PRV-05). */
  saveAsCustomerAddress: boolean;
};

export const EMPTY_POS_DELIVERY: PosDeliveryState = { address: "", postcode: "", notes: "", saveAsCustomerAddress: false };

/** The order body's delivery fields, or none for a collection. */
export function deliveryOrderFields(
  fulfilmentMethod: "collection" | "delivery",
  value: PosDeliveryState,
  customerId: string | null,
): Record<string, unknown> {
  if (fulfilmentMethod !== "delivery") return {};
  return {
    deliveryAddress: value.address.trim(),
    deliveryPostcode: value.postcode.trim(),
    ...(value.notes.trim() ? { deliveryNotes: value.notes.trim() } : {}),
    ...(value.saveAsCustomerAddress && customerId ? { saveAsCustomerAddress: true } : {}),
  };
}

/**
 * Where a delivery goes (v1.2 Phase 5, PRV-05). The order holds its own
 * address; the till asks for it whenever Delivery is chosen. "Use saved
 * address" fetches the customer's saved one (the server logs the read) into
 * the fields, where it can be changed for this order only.
 */
export function PosDeliveryDetails({
  value,
  onChange,
  customerId,
}: {
  value: PosDeliveryState;
  onChange: (next: PosDeliveryState) => void;
  customerId: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const useSaved = async () => {
    if (!customerId) return;
    setLoading(true);
    setNote(null);
    try {
      const res = await apiFetch(`/api/customers/${customerId}/saved-address`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? "Could not read the saved address");
      if (!body?.address) {
        setNote("No saved address for this customer.");
        return;
      }
      onChange({ ...value, address: body.address });
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not read the saved address");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border p-3" data-testid="pos-delivery-details">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-metal-warm-white">
          <MapPin className="h-4 w-4" aria-hidden />
          Delivery address
        </span>
        {customerId && (
          <Button type="button" variant="outline" size="sm" onClick={useSaved} disabled={loading} data-testid="button-use-saved-address">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Use saved address
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <div>
          <Label htmlFor="delivery-address">Address</Label>
          <Textarea
            id="delivery-address"
            rows={2}
            maxLength={DELIVERY_ADDRESS_MAX}
            value={value.address}
            onChange={(e) => onChange({ ...value, address: e.target.value })}
            data-testid="input-delivery-address"
          />
        </div>
        <div>
          <Label htmlFor="delivery-postcode">Postcode</Label>
          <Input
            id="delivery-postcode"
            maxLength={DELIVERY_POSTCODE_MAX}
            autoCapitalize="characters"
            value={value.postcode}
            onChange={(e) => onChange({ ...value, postcode: e.target.value })}
            data-testid="input-delivery-postcode"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="delivery-notes">Notes for the driver (optional)</Label>
        <Input
          id="delivery-notes"
          maxLength={DELIVERY_NOTES_MAX}
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          placeholder="Side door, ring twice"
          data-testid="input-delivery-notes"
        />
      </div>
      {customerId && (
        <label className="flex items-center gap-2 text-sm text-metal-muted">
          <Checkbox
            checked={value.saveAsCustomerAddress}
            onCheckedChange={(checked) => onChange({ ...value, saveAsCustomerAddress: checked === true })}
            data-testid="checkbox-save-delivery-address"
          />
          Save as their address
        </label>
      )}
      {note && <p className="text-sm text-metal-muted">{note}</p>}
    </section>
  );
}
