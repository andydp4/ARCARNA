import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { Button } from "@/components/ui/button";
import { useSeenOnce } from "@/hooks/useSeenOnce";
import { clearPendingReplay, hasPendingReplay } from "@/components/tour/tourReplay";
import { claimTourScreen, releaseTourScreen, tourScreenFree } from "@/components/tour/tourScreen";
import { findTourTarget, type TourTarget } from "@/components/tour/tourTarget";
import { placeCallout, VIEWPORT_MARGIN } from "@/components/tour/tourPlacement";

/**
 * The shared spotlight tour (v1.2 Phase 3). Started life as the Operations
 * Centre's tour (`OpsTour`); every Centre now uses it for its own short tour.
 *
 * Shown once per ACCOUNT via useSeenOnce (user_ui_seen, migration 069) — not
 * per browser — and replayable on demand through `startEvent`.
 *
 * Steps are resolved against the live DOM by `data-testid` at the moment the
 * tour opens; a step whose target is not rendered (a phone has no pinned
 * sidebar, a cashier has no Suppliers link) is dropped rather than shown
 * pointing at nothing.
 *
 * Only one tour holds the screen at a time (tourScreen.ts): a page's Centre
 * tour and its feature tour take turns rather than opening together.
 */

export interface TourStep extends TourTarget {
  title: string;
  body: string;
  /** Which side of the target the callout prefers; falls back to whichever side actually fits. */
  preferredSide: "bottom" | "top" | "left" | "right";
}

export interface SpotlightTourProps {
  steps: readonly TourStep[];
  /** Account-level seen key (shared/uiSeen.ts). */
  seenKey: string;
  /** The per-device flag this tour used before, if any (see useSeenOnce). */
  legacyLocalKey: string;
  /** Hold the auto-start until the page has real content. */
  ready: boolean;
  /** Window event that replays the tour, seen or not. */
  startEvent: string;
  /** Prefix for every test id and element id, e.g. "ops-tour". */
  idPrefix: string;
  /**
   * Wait (briefly) for this many step targets to render before auto-starting:
   * a lazily loaded page paints its header a beat after the route changes.
   */
  minStepsToStart?: number;
  /**
   * Auto-start only once this is on screen, however long that takes: a
   * feature tour waits for the feature itself (the label printer card appears
   * only on the System tab, a run's stops only once there are some).
   */
  anchor?: TourTarget;
}

/** Retries before starting with whatever steps have rendered. */
const START_ATTEMPTS = 12;
const START_RETRY_MS = 400;

const SPOTLIGHT_PADDING = 8;

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

export function SpotlightTour({
  steps: allSteps,
  seenKey,
  legacyLocalKey,
  ready,
  startEvent,
  idPrefix,
  minStepsToStart = 1,
  anchor,
}: SpotlightTourProps) {
  const { isAuthenticated, user } = useAuth();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [calloutHeight, setCalloutHeight] = useState<number | null>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  const focusedForStep = useRef<number | null>(null);

  const eligible = isAuthenticated && !!user && user.role !== "CUSTOMER";
  const { seen, markSeen } = useSeenOnce(seenKey, legacyLocalKey);

  const findSteps = useCallback(
    () => allSteps.filter((step) => findTourTarget(step)),
    [allSteps],
  );

  const openWithSteps = useCallback(
    (found: TourStep[] = findSteps()) => {
      if (found.length === 0) return;
      if (!claimTourScreen(idPrefix)) return;
      focusedForStep.current = null;
      setSteps(found);
      setStepIndex(0);
      setOpen(true);
    },
    [findSteps, idPrefix],
  );

  // Auto-start once, after the board has real content and nothing else (the
  // What's New modal, an edit sheet) already has the screen — two overlays
  // fighting for focus is worse than a tour that starts a beat late.
  useEffect(() => {
    if (!eligible || !ready || open) return;
    if (seen !== false) return;
    let cancelled = false;
    let timer = 0;
    let attempts = 0;
    const tryStart = () => {
      if (cancelled) return;
      // Neither waiting for the feature nor for another overlay uses up the
      // attempts: those only bound the wait for a page's own steps to render.
      if (document.querySelector('[role="dialog"]') || !tourScreenFree(idPrefix)) {
        timer = window.setTimeout(tryStart, START_RETRY_MS);
        return;
      }
      if (anchor && !findTourTarget(anchor)) {
        timer = window.setTimeout(tryStart, START_RETRY_MS);
        return;
      }
      attempts += 1;
      const found = findSteps();
      if (found.length < Math.min(minStepsToStart, allSteps.length) && attempts < START_ATTEMPTS) {
        timer = window.setTimeout(tryStart, START_RETRY_MS);
        return;
      }
      openWithSteps(found);
    };
    timer = window.setTimeout(tryStart, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [eligible, ready, open, openWithSteps, findSteps, seen, minStepsToStart, allSteps.length, idPrefix, anchor]);

  // "Replay tour" replays it on demand regardless of the seen flag. The page
  // may still be arriving (Replay tour from another page of the Centre), so
  // it waits for `ready` and the steps the same way the auto-start does,
  // rather than giving up on a first look that found nothing.
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const replayTimer = useRef<number | undefined>(undefined);
  const replay = useCallback(() => {
    window.clearTimeout(replayTimer.current);
    let attempts = 0;
    const attempt = () => {
      // Another tour is showing: wait for it, without spending attempts.
      if (!tourScreenFree(idPrefix)) {
        replayTimer.current = window.setTimeout(attempt, START_RETRY_MS);
        return;
      }
      attempts += 1;
      const found = findSteps();
      const enough = readyRef.current && found.length >= Math.min(minStepsToStart, allSteps.length);
      if (!enough && attempts < START_ATTEMPTS) {
        replayTimer.current = window.setTimeout(attempt, START_RETRY_MS);
        return;
      }
      clearPendingReplay(startEvent);
      openWithSteps(found);
    };
    attempt();
  }, [findSteps, openWithSteps, minStepsToStart, allSteps.length, startEvent, idPrefix]);

  useEffect(() => {
    window.addEventListener(startEvent, replay);
    // Asked for before this tour mounted: take it up now.
    if (hasPendingReplay(startEvent)) replay();
    return () => {
      window.removeEventListener(startEvent, replay);
      window.clearTimeout(replayTimer.current);
    };
  }, [replay, startEvent]);

  const finish = useCallback(() => {
    markSeen();
    setOpen(false);
    releaseTourScreen(idPrefix);
  }, [markSeen, idPrefix]);

  // Leaving the page mid-tour must not keep the screen from the next tour.
  useEffect(() => () => releaseTourScreen(idPrefix), [idPrefix]);

  const step = steps[stepIndex] as TourStep | undefined;

  const reposition = useCallback(() => {
    if (!step) return;
    const el = findTourTarget(step);
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

  // The callout's real height, for placing it (UI-07): measured after each
  // render of a step, before paint, so a tall callout never shows clipped.
  useLayoutEffect(() => {
    if (!open || !rect) return;
    const h = calloutRef.current?.offsetHeight ?? null;
    if (h && h !== calloutHeight) setCalloutHeight(h);
  });

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
  // so a target hard against an edge never produces an off-screen callout.
  // Placed with the callout's measured height once it has rendered (UI-07).
  const { top: calloutTop, left: calloutLeft } = placeCallout({
    highlight,
    preferredSide: step.preferredSide,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    calloutHeight,
  });

  return (
    <div className="fixed inset-0 z-[70]" role="presentation" data-testid={idPrefix}>
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
        aria-labelledby={`${idPrefix}-title`}
        aria-describedby={`${idPrefix}-body`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="fixed w-80 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none"
        style={{
          top: calloutTop,
          left: calloutLeft,
          maxWidth: `calc(100vw - ${2 * VIEWPORT_MARGIN}px)`,
          maxHeight: `calc(100vh - ${2 * VIEWPORT_MARGIN}px)`,
          overflowY: "auto",
        }}
        data-testid={`${idPrefix}-callout`}
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
            data-testid={`${idPrefix}-skip`}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <h2 id={`${idPrefix}-title`} className="mt-1 text-base font-semibold text-foreground">
          {step.title}
        </h2>
        <p id={`${idPrefix}-body`} className="mt-1 text-sm text-muted-foreground">
          {step.body}
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          {!isFirst && (
            <Button
              type="button"
              variant="outline"
              size="touch"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              data-testid={`${idPrefix}-back`}
            >
              Back
            </Button>
          )}
          <Button
            type="button"
            size="touch"
            onClick={() => (isLast ? finish() : setStepIndex((i) => i + 1))}
            data-testid={`${idPrefix}-next`}
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
