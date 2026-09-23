import { STORAGE_SIDEBAR_PINNED } from "@shared/storageKeys";

/**
 * Sidebar behaviour (v1.2 Phase 3), kept apart from the component so the rules
 * can be tested without a browser.
 *
 *  - hover: a mouse or trackpad. Opens on hover or keyboard focus, closes
 *    CLOSE_DELAY_MS after the pointer leaves, overlays the page so the board
 *    underneath does not jump.
 *  - tap: a tablet (touch, no hover). A tap on the menu button opens it; it
 *    overlays the page too and closes on a tap outside or on navigating.
 *  - phone: the slide-in sheet, unchanged.
 *
 * In hover and tap modes, the pin keeps it open and pushes the content aside
 * instead of overlaying it; the pin is remembered on the device.
 */
export type SidebarMode = "hover" | "tap" | "phone";

export const SIDEBAR_CLOSE_DELAY_MS = 500;

/** Media queries the mode is read from. */
export const PHONE_QUERY = "(max-width: 768px)";
export const HOVER_QUERY = "(hover: hover) and (pointer: fine)";

export function sidebarMode(input: { isPhone: boolean; canHover: boolean }): SidebarMode {
  if (input.isPhone) return "phone";
  return input.canHover ? "hover" : "tap";
}

export interface SidebarLayout {
  /** Labels shown (full width) rather than the icon rail. */
  expanded: boolean;
  /** Takes space in the page flow at full width (pinned); otherwise it floats over the page. */
  pushesContent: boolean;
}

/** What the rail looks like for a given pin / open state. Phones use the sheet instead. */
export function sidebarLayout(input: { mode: SidebarMode; pinned: boolean; open: boolean }): SidebarLayout {
  if (input.mode === "phone") return { expanded: input.open, pushesContent: false };
  if (input.pinned) return { expanded: true, pushesContent: true };
  return { expanded: input.open, pushesContent: false };
}

/**
 * Whether a keyboard or pointer event should open the rail in this mode.
 * Touch never opens on hover: a tablet fires pointerenter on every tap, and a
 * menu that opened on the tap meant to reach the page underneath would be a trap.
 */
export function opensOnPointerEnter(mode: SidebarMode, pointerType: string | undefined): boolean {
  return mode === "hover" && (pointerType === undefined || pointerType === "mouse" || pointerType === "pen");
}

export function readPinned(): boolean {
  try {
    return localStorage.getItem(STORAGE_SIDEBAR_PINNED) === "1";
  } catch {
    return false;
  }
}

export function writePinned(pinned: boolean): void {
  try {
    localStorage.setItem(STORAGE_SIDEBAR_PINNED, pinned ? "1" : "0");
  } catch {
    // Private mode or blocked storage: the pin still holds for this visit.
  }
}
