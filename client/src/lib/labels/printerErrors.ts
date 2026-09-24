/**
 * Turn whatever the Bluetooth stack or the printer threw into one sentence a
 * cashier can act on. The raw error still goes to the console for us.
 *
 * Printer status codes are the `PrinterErrorCode` values the printer sends in
 * its print-error packet (niimbluelib names them; a test pins these numbers
 * to the library's enum). They are copied here so this module — which the
 * UI imports up front — does not pull the printer library into the main
 * bundle.
 */

const PRINTER_CODE_MESSAGES: Record<number, string> = {
  1: "The printer lid is open. Close it firmly and try again.",
  2: "The printer is out of labels. Load a new roll and try again.",
  3: "The printer battery is low. Charge it and try again.",
  4: "The printer battery has a fault. Charge it or restart the printer.",
  5: "Printing was cancelled on the printer.",
  6: "The printer did not accept the label. Try again.",
  7: "The printer is too hot. Give it a few minutes and try again.",
  8: "The labels are not feeding. Open the lid, reseat the roll and try again.",
  9: "The printer is busy. Wait a moment and try again.",
  10: "The printer reports no print head. Restart the printer.",
  11: "The printer is too cold to print. Warm it up and try again.",
  12: "The printer's print head is loose. Close the lid firmly and try again.",
  16: "These labels do not match the printer. Load 50 × 30 mm labels and try again.",
  17: "The printer could not set the label type. Restart the printer and try again.",
  23: "The printer disconnected. Turn it on, bring it closer and try again.",
  28: "The printer cannot find the label edge. Open the lid, reseat the roll and try again.",
  52: "The printer timed out receiving the label. Bring it closer and try again.",
};

export const PRINTER_ERROR_CODES = {
  CoverOpen: 1,
  LackPaper: 2,
  LowBattery: 3,
  Overheat: 7,
  PaperOutException: 8,
  PrinterBusy: 9,
  WrongPaper: 16,
  Disconnect: 23,
  ECheckPaper: 28,
  ReceiveDataTimeout: 52,
} as const;

/**
 * A lid/paper fault from a heartbeat, as the sentence to show, or null when
 * the heartbeat is missing or reports nothing wrong (the printer's own error
 * then covers anything we missed).
 */
export function heartbeatFault(
  heartbeat: { lidClosed?: boolean; paperInserted?: boolean } | null | undefined,
): string | null {
  if (heartbeat?.lidClosed === false) return messageForPrinterCode(PRINTER_ERROR_CODES.CoverOpen);
  if (heartbeat?.paperInserted === false) return messageForPrinterCode(PRINTER_ERROR_CODES.LackPaper);
  return null;
}

export function messageForPrinterCode(code: number): string {
  return PRINTER_CODE_MESSAGES[code] ?? `The printer reported a problem (code ${code}). Check the lid and labels, then try again.`;
}

function errorName(error: unknown): string {
  if (error && typeof error === "object" && "name" in error) return String((error as { name: unknown }).name);
  return "";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

/** One plain sentence for any failure while connecting to or printing on a label printer. */
export function describePrintError(error: unknown): string {
  // niimbluelib's PrintError carries the printer's own status code.
  if (error && typeof error === "object" && "reasonId" in error) {
    const code = Number((error as { reasonId: unknown }).reasonId);
    if (Number.isFinite(code) && code > 0) return messageForPrinterCode(code);
  }
  const name = errorName(error);
  const message = errorMessage(error);
  // Web Bluetooth DOMExceptions.
  if (name === "NotFoundError") {
    return /cancel/i.test(message) || message === ""
      ? "No printer was chosen. Tap Connect and pick the printer from the list."
      : "No printer found. Turn the printer on, bring it closer and try again.";
  }
  if (name === "SecurityError") {
    return "The browser blocked Bluetooth. Tap the button again, and allow Bluetooth if asked.";
  }
  if (name === "NotAllowedError") {
    return "Bluetooth permission was refused. Allow Bluetooth for this site in the browser settings.";
  }
  if (name === "NetworkError" || /GATT|disconnected|Channel is closed/i.test(message)) {
    return "The printer disconnected. Turn it on, bring it closer and try again.";
  }
  if (/timeout/i.test(message)) {
    return "The printer stopped answering. Check it is on and close by, then try again.";
  }
  if (/Bluetooth adapter not available|bluetooth.*(off|unavailable)/i.test(message)) {
    return "Bluetooth is off on this device. Turn it on and try again.";
  }
  if (/Feature not supported/i.test(message)) {
    return "This printer does not support that. Only Niimbot B1-family printers are set up here.";
  }
  return "Printing failed. Check the printer is on, the lid is shut and labels are loaded, then try again.";
}
