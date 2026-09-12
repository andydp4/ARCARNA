/**
 * The board activates the focused control on Enter and has no single-letter
 * shortcuts, precisely because the counter's barcode scanner types its payload
 * as keydowns and finishes with Enter (finding G15 in the Operations Centre
 * brief). This is the guard that keeps a scan from completing an order.
 *
 * The headline case is the brief's own: a twelve-character burst followed by
 * Enter must produce zero activations.
 */
import { describe, expect, it } from "vitest";
import {
  createScannerBurstGuard,
  isPrintableKey,
  isScannerBurst,
  pruneStrokes,
  SCANNER_BURST_WINDOW_MS,
} from "../opsKeys";

/** A wedge scanner types at roughly one character every 10 ms. */
function burst(code: string, startAt: number, gapMs = 10) {
  return code.split("").map((key, index) => ({ key, at: startAt + index * gapMs }));
}

describe("scanner bursts versus a person pressing Enter", () => {
  it("ignores the Enter at the end of a twelve-character scan", () => {
    const guard = createScannerBurstGuard();
    const strokes = burst("5012345678900", 1_000);
    for (const stroke of strokes) guard.note(stroke.key, stroke.at);
    const enterAt = strokes[strokes.length - 1].at + 10;

    expect(guard.shouldIgnoreEnter(enterAt)).toBe(true);
  });

  it("honours Enter from a person who has typed nothing at all", () => {
    const guard = createScannerBurstGuard();
    expect(guard.shouldIgnoreEnter(5_000)).toBe(false);
  });

  it("honours Enter after human-speed typing in a search box", () => {
    // Three characters, but 300 ms apart — nobody's scanner is that slow and
    // everybody's fingers are.
    const guard = createScannerBurstGuard();
    guard.note("a", 0);
    guard.note("b", 300);
    guard.note("c", 600);
    expect(guard.shouldIgnoreEnter(900)).toBe(false);
  });

  it("needs three printable keys, not two", () => {
    const twoKeys = [
      { key: "a", at: 100 },
      { key: "b", at: 110 },
    ];
    expect(isScannerBurst(twoKeys, 120)).toBe(false);
    expect(isScannerBurst([...twoKeys, { key: "c", at: 120 }], 130)).toBe(true);
  });

  it("stops counting keys once they fall outside the window", () => {
    const strokes = [
      { key: "a", at: 0 },
      { key: "b", at: 10 },
      { key: "c", at: 20 },
    ];
    expect(isScannerBurst(strokes, 20)).toBe(true);
    // One tick past the window and the same three keys mean nothing.
    expect(isScannerBurst(strokes, SCANNER_BURST_WINDOW_MS + 21)).toBe(false);
  });

  it("treats only single-character keys as typing", () => {
    expect(isPrintableKey("a")).toBe(true);
    expect(isPrintableKey("7")).toBe(true);
    expect(isPrintableKey("Enter")).toBe(false);
    expect(isPrintableKey("ArrowDown")).toBe(false);

    // Arrow-key navigation around the lanes must never look like a scan.
    const arrows = [
      { key: "ArrowDown", at: 0 },
      { key: "ArrowDown", at: 5 },
      { key: "ArrowRight", at: 10 },
    ];
    expect(isScannerBurst(arrows, 12)).toBe(false);
  });

  it("keeps the buffer from growing without bound", () => {
    const strokes = burst("abcdefghijklmnop", 0);
    expect(pruneStrokes(strokes, 10_000)).toEqual([]);
  });

  it("forgets its history when the board loses focus", () => {
    const guard = createScannerBurstGuard();
    for (const stroke of burst("abcdef", 0)) guard.note(stroke.key, stroke.at);
    guard.reset();
    expect(guard.shouldIgnoreEnter(60)).toBe(false);
  });
});
