import type { OpsAlertKind } from "@shared/orders/opsAlerts";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function beep(frequency: number, durationMs: number): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.value = 0.08;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + durationMs / 1000);
}

export function playScanSuccessBeep(): void {
  beep(880, 80);
}

export function playScanFailBeep(): void {
  beep(220, 120);
}

// ---------------------------------------------------------------------------
// Operations Centre alert audio (Phase N, N5b).
//
// `beep()` above fires-and-forgets against whatever `AudioContext` exists —
// fine for a scan tone the cashier just heard themselves cause. An ops chime
// is different: it has to survive the browser's autoplay policy, which
// refuses to start (or keep running) an `AudioContext` until a real user
// gesture resumes it. `unlockAudio()` and `playOpsChime()` below are that
// seam, and the two together are the brief's whole "Audio" paragraph
// (docs/briefs/PHASE_N_OPERATIONS_CENTRE.md, "Alerts & notifications"):
// listen for a gesture, resume the SAME shared context `beep()` already uses
// (so a scan and an ops chime never fight over two contexts), and let a
// chime's own call site (`useOpsAlerts.ts`) ask first whether it is even
// worth trying.
// ---------------------------------------------------------------------------

/** Whether `unlockAudio()`'s own listeners are currently attached, so a second call is a no-op. */
let unlockListenersActive = false;

const unlockedListeners = new Set<() => void>();

function notifyUnlocked(): void {
  for (const listener of unlockedListeners) listener();
}

/** Subscribes to the moment the shared context first reaches `running`. Returns the unsubscribe. */
export function onAudioUnlocked(listener: () => void): () => void {
  unlockedListeners.add(listener);
  return () => unlockedListeners.delete(listener);
}

/** True once the shared `AudioContext` is actually running — WebAudio's own gate on making sound. */
export function isAudioUnlocked(): boolean {
  return audioCtx !== null && audioCtx.state === "running";
}

/**
 * Arms the browser's own gesture requirement, once. `pointerup`, `touchend`,
 * `click` and `keydown` (brief, verbatim — `touchend` specifically, not just
 * `pointerdown`, is finding G16: an iPad's own touch sequence never fires a
 * bare `pointerdown` a `resume()` can hang off) are listened for on `window`
 * with `{ passive: true }`; the context is created and `resume()`d FROM
 * INSIDE the handler (never before), because that is what the gesture
 * requirement is actually checking for. Listeners are removed only once the
 * context is confirmed `running` — a `resume()` call still pending, or one
 * the browser silently ignored, leaves them in place for the next gesture.
 */
export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  if (isAudioUnlocked()) return;
  if (unlockListenersActive) return;
  unlockListenersActive = true;

  const events = ["pointerup", "touchend", "click", "keydown"] as const;
  const onGesture = () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    ctx
      .resume()
      .then(() => {
        if (ctx.state !== "running") return;
        for (const type of events) window.removeEventListener(type, onGesture);
        unlockListenersActive = false;
        notifyUnlocked();
      })
      .catch(() => {
        /* the next gesture tries again — listeners stay attached */
      });
  };
  for (const type of events) window.addEventListener(type, onGesture, { passive: true });
}

/** One tone, scheduled `startOffset` seconds from now on the shared context. */
function scheduleTone(ctx: AudioContext, frequency: number, startOffset: number, durationMs: number, gainValue: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.value = gainValue;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  const startTime = ctx.currentTime + startOffset;
  oscillator.start(startTime);
  oscillator.stop(startTime + durationMs / 1000);
}

/** The brief's own gain figure — quieter than the scan beeps above, which are a single, deliberate tap. */
const OPS_CHIME_GAIN = 0.1;

/**
 * The one chime `chimeFor` ever asks to be played (brief, "Chime policy" /
 * "Audio"): "two-tone 660/880 Hz assigned/new, three rising due-soon, low
 * double 220 Hz late/customer-waiting". `delayed` never chimes (the brief's
 * own recipient table says so, and `chimeFor` never returns it) — reaching
 * the `default` branch here would be a caller bypassing that rule, not a
 * legitimate chime this function should invent a tone for.
 *
 * Returns `false` — same shape as `beep()`'s silent failure — when the
 * shared context is not `running`: iOS/iPadOS's hardware mute switch also
 * silences WebAudio outright regardless of this check, which is exactly why
 * the brief says the pulse and the card's own text remain the primary
 * channel and this is only ever a supplement to them.
 */
export function playOpsChime(kind: OpsAlertKind): boolean {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== "running") return false;

  switch (kind) {
    case "assigned":
    case "new_unassigned":
      scheduleTone(ctx, 660, 0, 120, OPS_CHIME_GAIN);
      scheduleTone(ctx, 880, 0.14, 150, OPS_CHIME_GAIN);
      return true;
    case "due_soon":
      scheduleTone(ctx, 660, 0, 100, OPS_CHIME_GAIN);
      scheduleTone(ctx, 780, 0.12, 100, OPS_CHIME_GAIN);
      scheduleTone(ctx, 900, 0.24, 130, OPS_CHIME_GAIN);
      return true;
    case "late":
    case "customer_waiting":
      scheduleTone(ctx, 220, 0, 160, OPS_CHIME_GAIN);
      scheduleTone(ctx, 220, 0.22, 160, OPS_CHIME_GAIN);
      return true;
    default:
      // `delayed` (never chimes, per the brief's table) or anything else a
      // caller passes that `chimeFor` itself would never have returned.
      return false;
  }
}
