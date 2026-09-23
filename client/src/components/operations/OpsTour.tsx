import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Compass, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { Button } from "@/components/ui/button";
import { LATEST_OPS_TOUR_VERSION, opsTourSeenKey } from "@shared/opsTour";
import { opsTourAccountKey } from "@shared/uiSeen";
import { useSeenOnce } from "@/hooks/useSeenOnce";

/**
 * A five-step spotlight tour of the Operations Centre, shown once per
 * release to anyone who reaches `/operations` — alongside `WhatsNewModal`,
 * not instead of it (the two are independent: this one is board-specific and
 * points at real elements, that one is the app-wide text summary). Shown once
 * per ACCOUNT via useSeenOnce (user_ui_seen, migration 069); it used to be a
 * per-browser localStorage flag, so it came back on every other device. The
 * old flag is still honoured, and copied up to the account once.
 *
 * Steps are resolved against the live DOM by `data-testid`, once, at the
 * moment the tour opens — a step whose target isn't currently rendered
 * (the "New order" pane doesn't exist in the phone/tablet tabbed layout) is
 * dropped rather than shown pointing at nothing.
 */

const START_EVENT = "arcarna:ops-tour:start";

/** Fired by the header's "Board tour" button to replay the tour on demand, seen or not. */
export function startOpsTour() {
  window.dispatchEvent(new Event(START_EVENT));
}

interface TourStep {
  testId: string;
  title: string;
  body: string;
  /** Which side of the target the callout prefers; falls back to whichever side actually fits. */
  preferredSide: "bottom" | "top" | "left" | "right";
}

const TOUR_STEPS: TourStep[] = [
  {
    testId: "ops-kpi-strip",
    title: "Board counts, at a glance",
    body: "Open, late now, due soon and done today — the same figures as always, now easier to read across the counter.",
    preferredSide: "bottom",
  },
  {
    testId: "ops-legend",
    title: "What the colours mean",
    body: "Every card's colour band matches one of these: ready, due soon, late, delayed, held or completed.",
    preferredSide: "bottom",
  },
  {
    testId: "ops-audio-toggle",
    title: "Sound and alerts",
    body: "Leave sound on and you'll get a chime the moment an order addressed to you needs attention.",
    preferredSide: "bottom",
  },
  {
    testId: "ops-lane-header-collection",
    title: "The board itself",
    body: "Orders move through here on their own as they're claimed, made ready, and handed over — nothing to refresh.",
    preferredSide: "right",
  },
  {
    testId: "ops-form-pane",
    title: "Take a new order",
    body: "Build and take payment for a sale right here, without ever leaving the board.",
    preferredSide: "left",
  },
];

const SPOTLIGHT_PADDING = 8;
const CALLOUT_GAP = 12;
const VIEWPORT_MARGIN = 16;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measure(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function OpsTour({ boardReady }: { boardReady: boolean }) {
  const { isAuthenticated, user } = useAuth();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  const focusedForStep = useRef<number | null>(null);

  const eligible = isAuthenticated && !!user && user.role !== "CUSTOMER";
  const { seen, markSeen } = useSeenOnce(
    opsTourAccountKey(LATEST_OPS_TOUR_VERSION),
    opsTourSeenKey(LATEST_OPS_TOUR_VERSION),
  );

  const openWithSteps = useCallback(() => {
    const found = TOUR_STEPS.filter((step) => document.querySelector(`[data-testid="${step.testId}"]`));
    if (found.length === 0) return;
    focusedForStep.current = null;
    setSteps(found);
    setStepIndex(0);
    setOpen(true);
  }, []);

  // Auto-start once, after the board has real content and nothing else (the
  // What's New modal, an edit sheet) already has the screen — two overlays
  // fighting for focus is worse than a tour that starts a beat late.
  useEffect(() => {
    if (!eligible || !boardReady || open) return;
    if (seen !== false) return;
    let cancelled = false;
    const tryStart = () => {
      if (cancelled) return;
      if (document.querySelector('[role="dialog"]')) {
        window.setTimeout(tryStart, 400);
        return;
      }
      openWithSteps();
    };
    const timer = window.setTimeout(tryStart, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [eligible, boardReady, open, openWithSteps, seen]);

  // The header's "Board tour" button replays it on demand regardless of the seen flag.
  useEffect(() => {
    const onStart = () => openWithSteps();
    window.addEventListener(START_EVENT, onStart);
    return () => window.removeEventListener(START_EVENT, onStart);
  }, [openWithSteps]);

  const finish = useCallback(() => {
    markSeen();
    setOpen(false);
  }, [markSeen]);

  const step = steps[stepIndex] as TourStep | undefined;

  const reposition = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(`[data-testid="${step.testId}"]`);
    if (!el) {
      finish();
      return;
    }
    el.scrollIntoView({ block: "center", behavior: prefersReducedMotion ? "auto" : "smooth" });
    // Scrolling is async; measure a beat later so the rect reflects where the element actually lands.
    window.setTimeout(() => setRect(measure(el)), prefersReducedMotion ? 0 : 260);
  }, [step, finish, prefersReducedMotion]);

  useLayoutEffect(() => {
    if (!open || !step) return;
    reposition();
  }, [open, step, reposition]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => reposition();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, reposition]);

  // The callout doesn't exist in the DOM until `rect` is first known (the
  // component renders null until then — see below), so this can't just key
  // off `[open, stepIndex]`: that fires a beat too early, before the ref has
  // anything to focus. Guarded by `focusedForStep` so a later reposition
  // (window resize, a scroll) never steals focus back a second time.
  useEffect(() => {
    if (!open || !rect) return;
    if (focusedForStep.current === stepIndex) return;
    focusedForStep.current = stepIndex;
    calloutRef.current?.focus();
  }, [open, stepIndex, rect]);

  if (!open || !step || !rect) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish();
      return;
    }
    if (event.key === "Tab") {
      const focusables = calloutRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)");
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  // Clamped to the viewport: a target taller or wider than the screen (a
  // scrollable lane, say) must never produce a spotlight ring — or a callout
  // anchored off it — that runs off-screen.
  const rawTop = rect.top - SPOTLIGHT_PADDING;
  const rawLeft = rect.left - SPOTLIGHT_PADDING;
  const rawBottom = rect.top + rect.height + SPOTLIGHT_PADDING;
  const rawRight = rect.left + rect.width + SPOTLIGHT_PADDING;
  const highlight = {
    top: Math.max(0, rawTop),
    left: Math.max(0, rawLeft),
    width: Math.min(rawRight, window.innerWidth) - Math.max(0, rawLeft),
    height: Math.min(rawBottom, window.innerHeight) - Math.max(0, rawTop),
  };

  // Prefer the requested side; fall back to whichever axis actually has room,
  // so a target hard against an edge (the form pane, flush against the right
  // edge of the viewport) never produces an off-screen callout.
  const spaceBelow = window.innerHeight - (highlight.top + highlight.height);
  const spaceAbove = highlight.top;
  const spaceRight = window.innerWidth - (highlight.left + highlight.width);
  const spaceLeft = highlight.left;
  const CALLOUT_WIDTH = 320;
  const CALLOUT_HEIGHT_ESTIMATE = 160;

  let side = step.preferredSide;
  if (side === "bottom" && spaceBelow < CALLOUT_HEIGHT_ESTIMATE && spaceAbove > spaceBelow) side = "top";
  if (side === "top" && spaceAbove < CALLOUT_HEIGHT_ESTIMATE && spaceBelow > spaceAbove) side = "bottom";
  if (side === "right" && spaceRight < CALLOUT_WIDTH && spaceLeft > spaceRight) side = "left";
  if (side === "left" && spaceLeft < CALLOUT_WIDTH && spaceRight > spaceLeft) side = "right";

  let calloutTop: number;
  let calloutLeft: number;
  if (side === "bottom" || side === "top") {
    calloutTop = side === "bottom" ? highlight.top + highlight.height + CALLOUT_GAP : highlight.top - CALLOUT_GAP - CALLOUT_HEIGHT_ESTIMATE;
    calloutLeft = highlight.left + highlight.width / 2 - CALLOUT_WIDTH / 2;
  } else {
    calloutLeft = side === "right" ? highlight.left + highlight.width + CALLOUT_GAP : highlight.left - CALLOUT_GAP - CALLOUT_WIDTH;
    calloutTop = highlight.top + highlight.height / 2 - CALLOUT_HEIGHT_ESTIMATE / 2;
  }
  calloutLeft = Math.min(
    Math.max(calloutLeft, VIEWPORT_MARGIN),
    window.innerWidth - CALLOUT_WIDTH - VIEWPORT_MARGIN,
  );
  calloutTop = Math.min(
    Math.max(calloutTop, VIEWPORT_MARGIN),
    window.innerHeight - CALLOUT_HEIGHT_ESTIMATE - VIEWPORT_MARGIN,
  );

  return (
    <div className="fixed inset-0 z-[70]" role="presentation" data-testid="ops-tour">
      {/* Four-panel mask around the highlight — dims everything else without
          a single giant translucent layer sitting over (and dulling click
          targets on) the spotlighted element itself. */}
      <div className="fixed bg-black/70" style={{ top: 0, left: 0, right: 0, height: Math.max(0, highlight.top) }} />
      <div
        className="fixed bg-black/70"
        style={{ top: highlight.top + highlight.height, left: 0, right: 0, bottom: 0 }}
      />
      <div
        className="fixed bg-black/70"
        style={{ top: highlight.top, left: 0, width: Math.max(0, highlight.left), height: highlight.height }}
      />
      <div
        className="fixed bg-black/70"
        style={{ top: highlight.top, left: highlight.left + highlight.width, right: 0, height: highlight.height }}
      />
      <div
        aria-hidden
        className="fixed rounded-lg ring-2 ring-truth-bright"
        style={{ top: highlight.top, left: highlight.left, width: highlight.width, height: highlight.height }}
      />

      <div
        ref={calloutRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ops-tour-title"
        aria-describedby="ops-tour-body"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="fixed w-80 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none"
        style={{ top: calloutTop, left: calloutLeft }}
        data-testid="ops-tour-callout"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Step {stepIndex + 1} of {steps.length}
          </p>
          <button
            type="button"
            onClick={finish}
            aria-label="Skip the tour"
            className="rounded-sm text-muted-foreground hover:text-foreground"
            data-testid="ops-tour-skip"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <h2 id="ops-tour-title" className="mt-1 text-base font-semibold text-foreground">
          {step.title}
        </h2>
        <p id="ops-tour-body" className="mt-1 text-sm text-muted-foreground">
          {step.body}
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          {!isFirst && (
            <Button
              type="button"
              variant="outline"
              size="touch"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              data-testid="ops-tour-back"
            >
              Back
            </Button>
          )}
          <Button
            type="button"
            size="touch"
            onClick={() => (isLast ? finish() : setStepIndex((i) => i + 1))}
            data-testid="ops-tour-next"
          >
            {isLast ? "Got it" : "Next"}
          </Button>
        </div>
      </div>

      {/* Announced once per step for a screen-reader user, who cannot see the spotlight move. */}
      <p className="sr-only" role="status">
        Step {stepIndex + 1} of {steps.length}: {step.title}. {step.body}
      </p>
    </div>
  );
}

/** The header's persistent "replay the tour" affordance — always available, seen or not. */
export function OpsTourButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="touch"
      onClick={startOpsTour}
      data-testid="ops-tour-restart"
    >
      <Compass className="h-4 w-4" aria-hidden />
      Board tour
    </Button>
  );
}
