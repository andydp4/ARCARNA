/**
 * Telling a person's Enter apart from a barcode scanner's.
 *
 * The counter's keyboard-wedge scanner types its payload as ordinary keydown
 * events and finishes with Enter. `useBarcodeScanner` consumes that trailing
 * Enter only AFTER the whole burst has already bubbled on `window` (finding
 * G15 in docs/briefs/PHASE_N_OPERATIONS_CENTRE.md), so anything on the board
 * that acts on Enter — and Enter is the board's one activation key, because
 * single-letter shortcuts would fire from the scan itself — would complete an
 * order every time somebody scanned a product.
 *
 * The test is deliberately about SPEED, not about the buffer's contents: a
 * human cannot type three printable characters in a quarter of a second and
 * then press Enter, and a wedge scanner cannot do anything slower. Three
 * printable keydowns inside the previous 250 ms means the Enter that follows
 * belongs to the scanner and the board ignores it (brief, "Keyboard & focus").
 *
 * Pure by design, `now` injected, so the twelve-character-burst case in
 * __tests__/opsKeys.test.ts asserts real timings rather than mocking a clock.
 */

/** Printable keydowns inside this window count towards a burst. */
export const SCANNER_BURST_WINDOW_MS = 250;

/** Three or more of them means the following Enter is not a person's. */
export const SCANNER_BURST_MIN_KEYS = 3;

export interface KeyStroke {
  /** `KeyboardEvent.key`. Only single-character keys count as printable. */
  key: string;
  /** `KeyboardEvent.timeStamp`, or any monotonic millisecond reading. */
  at: number;
}

/** A single-character key — "a", "7", "-". Enter, Tab and the arrows are not. */
export function isPrintableKey(key: string): boolean {
  return key.length === 1;
}

/**
 * Whether an Enter arriving at `now` is the tail of a scanner burst.
 * `strokes` is the recent printable-key history, oldest first.
 */
export function isScannerBurst(
  strokes: readonly KeyStroke[],
  now: number,
  windowMs: number = SCANNER_BURST_WINDOW_MS,
  minKeys: number = SCANNER_BURST_MIN_KEYS,
): boolean {
  let within = 0;
  for (const stroke of strokes) {
    if (!isPrintableKey(stroke.key)) continue;
    if (now - stroke.at <= windowMs && now >= stroke.at) within += 1;
  }
  return within >= minKeys;
}

/** Drops strokes that can no longer influence a burst, so the buffer cannot grow. */
export function pruneStrokes(
  strokes: readonly KeyStroke[],
  now: number,
  windowMs: number = SCANNER_BURST_WINDOW_MS,
): KeyStroke[] {
  return strokes.filter((stroke) => now - stroke.at <= windowMs);
}

export interface ScannerBurstGuard {
  /** Feed every keydown the board sees, including Enter. */
  note(key: string, at: number): void;
  /** True when the Enter arriving at `at` belongs to a scan, not a person. */
  shouldIgnoreEnter(at: number): boolean;
  /** Forgets the history — used when the board loses focus. */
  reset(): void;
}

/**
 * The stateful wrapper the board attaches to its root. Kept separate from the
 * pure functions above so the rule can be tested without a DOM, and so the
 * board holds exactly one buffer rather than one per card.
 */
export function createScannerBurstGuard(
  windowMs: number = SCANNER_BURST_WINDOW_MS,
  minKeys: number = SCANNER_BURST_MIN_KEYS,
): ScannerBurstGuard {
  let strokes: KeyStroke[] = [];
  return {
    note(key, at) {
      if (!isPrintableKey(key)) return;
      strokes = pruneStrokes(strokes, at, windowMs);
      strokes.push({ key, at });
    },
    shouldIgnoreEnter(at) {
      return isScannerBurst(strokes, at, windowMs, minKeys);
    },
    reset() {
      strokes = [];
    },
  };
}
