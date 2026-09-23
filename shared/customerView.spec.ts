import { describe, expect, it } from "vitest";
import { deviceCustomerRow, duplicatePrompt, formatUkPhone, hasContactDetails, isMaskedValue, maskEmail, maskPhone, shortName, withoutContactDetails } from "./customerView";
import { checkDeliveryDetails, normalisePostcode, readDeliveryDetails } from "./orders/delivery";

describe("formatUkPhone (PRV-06)", () => {
  it("reads the ways a UK number is written as one +44 number", () => {
    for (const raw of ["07700 900123", "07700900123", "+44 7700 900123", "+44 (0)7700 900123", "0044 7700 900123", "447700900123", "7700900123"]) {
      expect(formatUkPhone(raw), raw).toBe("+447700900123");
    }
    expect(formatUkPhone("020 7946 0018")).toBe("+442079460018");
  });

  it("does not guess at part of a number: no partial matches", () => {
    for (const raw of ["", "0123", "900123", "07700 9001", "+1 415 555 0100", null, undefined]) {
      expect(formatUkPhone(raw as string), String(raw)).toBeNull();
    }
  });
});

describe("masks (Q7)", () => {
  it("••4821 and j•••@gmail.com", () => {
    expect(maskPhone("07700 904821")).toBe("••4821");
    expect(maskEmail("jane.smith@gmail.com")).toBe("j•••@gmail.com");
    expect(maskPhone("")).toBeNull();
    expect(maskEmail("  ")).toBeNull();
  });

  it("a masked value is recognised, so it is never saved back", () => {
    expect(isMaskedValue(maskPhone("07700 904821"))).toBe(true);
    expect(isMaskedValue(maskEmail("j@x.com"))).toBe(true);
    expect(isMaskedValue("07700 904821")).toBe(false);
  });
});

describe("the duplicate prompt", () => {
  it("names someone by first name and initial with the masked number", () => {
    expect(shortName("Jane Smith")).toBe("Jane S.");
    expect(duplicatePrompt({ id: "c1", displayName: shortName("Jane Smith"), phoneMasked: "••4821" })).toBe(
      "Already on the system: Jane S. (••4821), use them?",
    );
  });
});

describe("delivery details (PRV-05)", () => {
  it("a delivery needs an address and postcode; a collection carries none", () => {
    const blank = readDeliveryDetails({ deliveryAddress: "  ", deliveryPostcode: "" });
    expect(checkDeliveryDetails("delivery", blank)).toMatchObject({ ok: false, code: "DELIVERY_ADDRESS_REQUIRED" });
    const full = readDeliveryDetails({ deliveryAddress: "1 High St", deliveryPostcode: "sw1a1aa", deliveryNotes: " side door " });
    expect(checkDeliveryDetails("delivery", full)).toEqual({
      ok: true,
      details: { deliveryAddress: "1 High St", deliveryPostcode: "SW1A 1AA", deliveryNotes: "side door" },
    });
    expect(checkDeliveryDetails("collection", full)).toEqual({
      ok: true,
      details: { deliveryAddress: null, deliveryPostcode: null, deliveryNotes: null },
    });
  });

  it("formats a postcode it recognises and keeps one it does not", () => {
    expect(normalisePostcode("m1 1ae")).toBe("M1 1AE");
    expect(normalisePostcode("BFPO 123")).toBe("BFPO 123");
  });
});

describe("device copies (PRV-07)", () => {
  it("a device keeps the cashier view, masks made from a full row", () => {
    const row = deviceCustomerRow({
      id: "c1",
      orgId: "o1",
      name: "Jane Smith",
      phone: "07700 904821",
      email: "jane@gmail.com",
      address: "1 High Street",
      totalSpent: "10.00",
      category: "Gold",
      loyaltyPoints: 5,
    });
    expect(row).toEqual({
      id: "c1",
      name: "Jane Smith",
      category: "Gold",
      loyaltyPoints: 5,
      hasPhone: true,
      hasEmail: true,
      phoneLast4: "4821",
      phoneMasked: "••4821",
      emailMasked: "j•••@gmail.com",
    });
  });

  it("keeps a cashier-view row as it is", () => {
    const cashier = { id: "c1", name: "Jane", category: "Bronze", loyaltyPoints: 0, hasPhone: false, hasEmail: false, phoneLast4: null, phoneMasked: null, emailMasked: null };
    expect(deviceCustomerRow(cashier)).toEqual(cashier);
  });

  it("a queued edit or draft holds no contact details", () => {
    const edit = { name: "Jane", phone: "07700 904821", email: "j@x.com", address: "1 Road", replacePhone: "07700 1", category: "Gold" };
    expect(hasContactDetails(edit)).toBe(true);
    expect(withoutContactDetails(edit)).toEqual({ name: "Jane", category: "Gold" });
    expect(hasContactDetails({ name: "Jane", phone: "" })).toBe(false);
  });
});
