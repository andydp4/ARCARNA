/**
 * Can this browser talk to a Bluetooth label printer, and if not, what should
 * the person holding the device do instead?
 *
 * Niimbot printers are reached over Web Bluetooth, which only Chromium
 * browsers ship. Every iPhone/iPad browser is WebKit underneath (Apple's
 * rule), so none of them have it — except Bluefy, a free iOS browser that
 * adds it. Safari on a Mac has none either. A Print button that silently does
 * nothing on those tills is worse than no button, so the UI shows this
 * message in its place.
 */

export type PrinterSupport =
  | { supported: true }
  | { supported: false; reason: "ios" | "mac-safari" | "insecure" | "other"; message: string };

export interface SupportEnv {
  /** `"bluetooth" in navigator` */
  hasBluetooth: boolean;
  /** `window.isSecureContext` — Web Bluetooth is hidden on plain http. */
  isSecureContext: boolean;
  userAgent: string;
  /** `navigator.maxTouchPoints` — an iPad in desktop mode claims to be a Mac. */
  maxTouchPoints: number;
}

export const SUPPORT_MESSAGES = {
  ios: "Label printing needs Bluetooth, which iPhone and iPad browsers do not have. On iPhone, open arcarna in the Bluefy app (free on the App Store) to print labels.",
  "mac-safari": "Safari cannot reach Bluetooth printers. Open arcarna in Chrome on this Mac to print labels.",
  insecure: "Label printing only works when arcarna is opened over a secure (https) address.",
  other: "This browser cannot reach Bluetooth printers. Open arcarna in Chrome or Edge on this computer to print labels.",
} as const;

function isAppleTouchDevice(env: SupportEnv): boolean {
  const ua = env.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ sends a Mac user agent by default; touch points give it away.
  return /Macintosh/i.test(ua) && env.maxTouchPoints > 1;
}

export function detectPrinterSupport(env: SupportEnv): PrinterSupport {
  // Bluefy on iOS does expose navigator.bluetooth, so the capability check
  // comes first and the platform guesses only explain its absence.
  if (env.hasBluetooth && env.isSecureContext) return { supported: true };
  if (!env.isSecureContext && env.hasBluetooth) {
    return { supported: false, reason: "insecure", message: SUPPORT_MESSAGES.insecure };
  }
  if (isAppleTouchDevice(env)) return { supported: false, reason: "ios", message: SUPPORT_MESSAGES.ios };
  const ua = env.userAgent;
  if (/Macintosh/i.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) {
    return { supported: false, reason: "mac-safari", message: SUPPORT_MESSAGES["mac-safari"] };
  }
  if (!env.isSecureContext) {
    return { supported: false, reason: "insecure", message: SUPPORT_MESSAGES.insecure };
  }
  return { supported: false, reason: "other", message: SUPPORT_MESSAGES.other };
}

/** The live browser's environment; safe to call during SSR/tests (reports unsupported). */
export function currentSupportEnv(): SupportEnv {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return { hasBluetooth: false, isSecureContext: false, userAgent: "", maxTouchPoints: 0 };
  }
  return {
    hasBluetooth: "bluetooth" in navigator && Boolean((navigator as Navigator & { bluetooth?: unknown }).bluetooth),
    isSecureContext: window.isSecureContext,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  };
}
