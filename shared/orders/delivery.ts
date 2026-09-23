/**
 * Where a delivery goes (v1.2 Phase 5, PRV-05). The order holds its own
 * address, postcode and notes. The till must fill in the address and postcode
 * when Delivery is chosen; the notes ("side door", "ring twice") are optional.
 *
 * Pure, so the till, the server and the offline queue read one rule.
 */

export const DELIVERY_ADDRESS_MAX = 1024;
export const DELIVERY_POSTCODE_MAX = 16;
export const DELIVERY_NOTES_MAX = 500;

export type DeliveryDetails = {
  deliveryAddress: string | null;
  deliveryPostcode: string | null;
  deliveryNotes: string | null;
};

export const NO_DELIVERY: DeliveryDetails = { deliveryAddress: null, deliveryPostcode: null, deliveryNotes: null };

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** "sw1a 1aa" → "SW1A 1AA". Not validated beyond length: a wrong-looking postcode still gets a van there. */
export function normalisePostcode(value: unknown): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/.test(compact)) {
    return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  }
  return raw.toUpperCase().replace(/\s+/g, " ");
}

/** The delivery fields of a request body, trimmed, blanks as null. Never throws. */
export function readDeliveryDetails(body: Record<string, unknown> | null | undefined): DeliveryDetails {
  const b = body ?? {};
  return {
    deliveryAddress: clean(b.deliveryAddress),
    deliveryPostcode: normalisePostcode(b.deliveryPostcode),
    deliveryNotes: clean(b.deliveryNotes),
  };
}

/** True when the body carries any delivery field at all (an edit that does not touch them leaves them alone). */
export function hasDeliveryFields(body: Record<string, unknown> | null | undefined): boolean {
  const b = body ?? {};
  return "deliveryAddress" in b || "deliveryPostcode" in b || "deliveryNotes" in b;
}

export type DeliveryCheck = { ok: true; details: DeliveryDetails } | { ok: false; message: string; code: string };

/**
 * The till's rule: a delivery needs an address and a postcode; a collection
 * carries none (a stale address from a Delivery tap that was changed back is
 * dropped, not stored against a collection).
 */
export function checkDeliveryDetails(
  fulfilmentMethod: string | null | undefined,
  details: DeliveryDetails,
): DeliveryCheck {
  if (fulfilmentMethod !== "delivery") return { ok: true, details: NO_DELIVERY };
  if (details.deliveryAddress && details.deliveryAddress.length > DELIVERY_ADDRESS_MAX) {
    return { ok: false, message: "The delivery address is too long.", code: "DELIVERY_ADDRESS_TOO_LONG" };
  }
  if (details.deliveryPostcode && details.deliveryPostcode.length > DELIVERY_POSTCODE_MAX) {
    return { ok: false, message: "The postcode is too long.", code: "DELIVERY_POSTCODE_TOO_LONG" };
  }
  if (details.deliveryNotes && details.deliveryNotes.length > DELIVERY_NOTES_MAX) {
    return { ok: false, message: "The delivery notes are too long.", code: "DELIVERY_NOTES_TOO_LONG" };
  }
  if (!details.deliveryAddress || !details.deliveryPostcode) {
    return {
      ok: false,
      message: "Add the delivery address and postcode before taking payment.",
      code: "DELIVERY_ADDRESS_REQUIRED",
    };
  }
  return { ok: true, details };
}

/** The saved-address line written when "Save as their address" is ticked. */
export function savedAddressLine(details: DeliveryDetails): string | null {
  const parts = [details.deliveryAddress, details.deliveryPostcode].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
