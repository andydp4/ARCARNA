import { useEffect, useRef } from "react";

type EditableLike = { tagName?: string; isContentEditable?: boolean };

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as EditableLike;
  const tag = (el.tagName ?? "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  return false;
}

export type ScannerKeyEvent = {
  key: string;
  timeStamp: number;
};

const MIN_SCAN_LENGTH = 6;
const MAX_INTER_KEY_MS = 30;

/** Detect keyboard-wedge scanner bursts: fast keystrokes ending with Enter. */
export function consumeScannerBurst(
  events: ScannerKeyEvent[],
  now = Date.now(),
): { code: string | null; remaining: ScannerKeyEvent[] } {
  if (events.length === 0) return { code: null, remaining: [] };

  const last = events[events.length - 1];
  if (last.key !== "Enter") {
    if (now - last.timeStamp > MAX_INTER_KEY_MS * 4) {
      return { code: null, remaining: [] };
    }
    return { code: null, remaining: events };
  }

  const chars: string[] = [];
  for (let i = events.length - 2; i >= 0; i -= 1) {
    const current = events[i];
    const next = events[i + 1];
    if (next.timeStamp - current.timeStamp > MAX_INTER_KEY_MS) break;
    if (current.key.length !== 1) break;
    chars.unshift(current.key);
  }

  if (chars.length < MIN_SCAN_LENGTH) {
    return { code: null, remaining: [] };
  }

  return { code: chars.join(""), remaining: [] };
}

export function useBarcodeScanner(onScan: (code: string) => void, enabled = true): void {
  const bufferRef = useRef<ScannerKeyEvent[]>([]);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      bufferRef.current.push({ key: event.key, timeStamp: event.timeStamp });
      const { code, remaining } = consumeScannerBurst(bufferRef.current, event.timeStamp);
      bufferRef.current = remaining;
      if (code) {
        event.preventDefault();
        onScanRef.current(code);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
