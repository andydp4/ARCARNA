/**
 * Niimbot labels: barcode symbols, browser capability messages, and the
 * plain-English printer errors.
 */
import { describe, expect, it } from "vitest";
import {
  barcodeForProduct,
  code128Values,
  ean13CheckDigit,
  encodeCode128,
  encodeEan13,
  isValidEan13,
} from "@/lib/labels/barcode";
import { SUPPORT_MESSAGES, detectPrinterSupport, type SupportEnv } from "@/lib/labels/printerSupport";
import { describePrintError, heartbeatFault } from "@/lib/labels/printerErrors";

const bits = (m: boolean[]) => m.map((b) => (b ? "1" : "0")).join("");

describe("Code 128", () => {
  // Reference module strings cross-checked against JsBarcode 3.12.3.
  it("encodes Code B text", () => {
    expect(bits(encodeCode128("Wikipedia")!.modules)).toBe(
      "11010010000111010001101000011010011000010010100001101001010011110010110010000100001001101000011010010010110000111100100101100011101011",
    );
  });
  it("encodes an even run of digits as Code C", () => {
    expect(code128Values("12345678")).toEqual([105, 12, 34, 56, 78, 47, 106]);
    expect(bits(encodeCode128("12345678")!.modules)).toBe(
      "1101001110010110011100100010110001110001011011000010100100011101101100011101011",
    );
  });
  it("finishes an odd run of digits in Code B", () => {
    // 105 + 12·1 + 34·2 + 56·3 + 100·4 + 23·5 = 868 → 868 mod 103 = 44
    expect(code128Values("1234567")).toEqual([105, 12, 34, 56, 100, 23, 44, 106]);
  });
  it("every symbol value is 11 modules and stop is 13", () => {
    const one = encodeCode128("A")!; // start, A, check, stop
    expect(one.modules.length).toBe(11 * 3 + 13);
  });
  it("refuses text outside printable ASCII", () => {
    expect(encodeCode128("café")).toBeNull();
    expect(encodeCode128("")).toBeNull();
  });
});

describe("EAN-13", () => {
  it("validates check digits, and takes a 12-digit UPC-A", () => {
    expect(ean13CheckDigit("501234567890")).toBe(0);
    expect(isValidEan13("5012345678900")).toBe(true);
    expect(isValidEan13("5012345678901")).toBe(false);
    expect(isValidEan13("036000291452")).toBe(true); // UPC-A
    expect(encodeEan13("036000291452")!.text).toBe("0036000291452");
  });
  it("encodes guards, parity and digits (95 modules)", () => {
    expect(bits(encodeEan13("5012345678900")!.modules)).toBe(
      "10100011010110011001101101111010100011011100101010101000010001001001000111010011100101110010101",
    );
  });
  it("products: valid EAN → EAN-13, anything else → Code 128, none → nothing", () => {
    expect(barcodeForProduct("4006381333931")?.kind).toBe("ean13");
    expect(barcodeForProduct("4006381333930")?.kind).toBe("code128");
    expect(barcodeForProduct("WM-0042")?.kind).toBe("code128");
    expect(barcodeForProduct("  ")).toBeNull();
    expect(barcodeForProduct(null)).toBeNull();
  });
});

describe("capability detection", () => {
  const env = (over: Partial<SupportEnv>): SupportEnv => ({
    hasBluetooth: false,
    isSecureContext: true,
    userAgent: "",
    maxTouchPoints: 0,
    ...over,
  });
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const macSafari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const macChrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  const macFirefox = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0";

  it("iPhone Safari/Chrome: send them to Bluefy", () => {
    const r = detectPrinterSupport(env({ userAgent: iphone }));
    expect(r).toEqual({ supported: false, reason: "ios", message: SUPPORT_MESSAGES.ios });
    expect(SUPPORT_MESSAGES.ios).toContain("On iPhone, open arcarna in the Bluefy app");
  });
  it("an iPad in desktop mode is still iOS", () => {
    expect(detectPrinterSupport(env({ userAgent: macSafari, maxTouchPoints: 5 })).supported === false &&
      (detectPrinterSupport(env({ userAgent: macSafari, maxTouchPoints: 5 })) as { reason: string }).reason).toBe("ios");
  });
  it("Bluefy on iPhone has Bluetooth, so it is supported", () => {
    expect(detectPrinterSupport(env({ userAgent: iphone, hasBluetooth: true }))).toEqual({ supported: true });
  });
  it("Safari on a Mac: open in Chrome", () => {
    const r = detectPrinterSupport(env({ userAgent: macSafari }));
    expect(r).toMatchObject({ supported: false, reason: "mac-safari" });
    expect(SUPPORT_MESSAGES["mac-safari"]).toContain("Open arcarna in Chrome on this Mac");
  });
  it("Chrome on a Mac is supported", () => {
    expect(detectPrinterSupport(env({ userAgent: macChrome, hasBluetooth: true }))).toEqual({ supported: true });
  });
  it("Firefox: use Chrome or Edge", () => {
    expect(detectPrinterSupport(env({ userAgent: macFirefox }))).toMatchObject({ reason: "other" });
  });
  it("Chrome/Brave with Bluetooth turned off or blocked: say so, do not send them to Chrome", () => {
    const r = detectPrinterSupport(env({ userAgent: macChrome }));
    expect(r).toMatchObject({ supported: false, reason: "bluetooth-blocked" });
    expect(SUPPORT_MESSAGES["bluetooth-blocked"]).toMatch(/turned off or blocked in this browser/);
    const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";
    expect(detectPrinterSupport(env({ userAgent: edge }))).toMatchObject({ reason: "bluetooth-blocked" });
  });
  it("plain http hides Bluetooth: say so", () => {
    expect(detectPrinterSupport(env({ userAgent: macChrome, hasBluetooth: true, isSecureContext: false }))).toMatchObject({ reason: "insecure" });
    expect(detectPrinterSupport(env({ userAgent: macChrome, isSecureContext: false }))).toMatchObject({ reason: "insecure" });
  });
});

describe("heartbeat pre-check", () => {
  it("names a lid or paper fault, and stays quiet otherwise", () => {
    expect(heartbeatFault({ lidClosed: false, paperInserted: true })).toMatch(/lid is open/);
    expect(heartbeatFault({ lidClosed: true, paperInserted: false })).toMatch(/out of labels/);
    expect(heartbeatFault({ lidClosed: true, paperInserted: true })).toBeNull();
    // No fresh heartbeat (the ask failed): let the printer report its own error.
    expect(heartbeatFault(undefined)).toBeNull();
  });
});

describe("printer errors in plain English", () => {
  const printError = (reasonId: number) => Object.assign(new Error(`Print error ${reasonId}`), { reasonId });
  const dom = (name: string, message = "") => Object.assign(new Error(message), { name });

  it("paper and cover", () => {
    expect(describePrintError(printError(1))).toMatch(/lid is open/);
    expect(describePrintError(printError(2))).toMatch(/out of labels/);
    expect(describePrintError(printError(16))).toMatch(/50 × 30 mm/);
    expect(describePrintError(printError(99))).toMatch(/code 99/);
  });
  it("Bluetooth failures", () => {
    expect(describePrintError(dom("NotFoundError", "User cancelled the requestDevice() chooser."))).toMatch(/No printer was chosen/);
    expect(describePrintError(dom("NetworkError", "GATT Server is disconnected."))).toMatch(/disconnected/);
    expect(describePrintError(dom("SecurityError"))).toMatch(/blocked Bluetooth/);
    expect(describePrintError(new Error("Timeout waiting response (waited for 0xa3)"))).toMatch(/stopped answering/);
    expect(describePrintError("???")).toMatch(/Printing failed/);
  });
});
