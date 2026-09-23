import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LATEST_OPS_TOUR_VERSION, opsTourSeenKey } from "@shared/opsTour";
import { opsTourAccountKey } from "@shared/uiSeen";
import { SpotlightTour, type TourStep } from "@/components/tour/SpotlightTour";
import { requestTourReplay } from "@/components/tour/tourReplay";

/**
 * The Operations Centre's tour: five spotlight steps over the board, shown
 * once per account to anyone who reaches `/operations`, alongside
 * `WhatsNewModal` rather than instead of it. The engine is the shared
 * `SpotlightTour` (v1.2 Phase 3), which every other Centre's tour uses too;
 * the account key and test ids are unchanged, so nobody who has seen it
 * already is shown it again.
 */

const START_EVENT = "arcarna:ops-tour:start";

/** Fired by the header's "Board tour" button to replay the tour on demand, seen or not. */
export function startOpsTour() {
  requestTourReplay(START_EVENT);
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
  {
    // Phones and portrait tablets: the same New order pane, one tab away.
    // Only one of this and the step above is ever rendered.
    testId: "ops-tab-order",
    title: "Take a new order",
    body: "Tap New order to build and take payment for a sale without leaving the board. The Board tab counts what arrives meanwhile.",
    preferredSide: "bottom",
  },
];

export function OpsTour({ boardReady }: { boardReady: boolean }) {
  return (
    <SpotlightTour
      steps={TOUR_STEPS}
      seenKey={opsTourAccountKey(LATEST_OPS_TOUR_VERSION)}
      legacyLocalKey={opsTourSeenKey(LATEST_OPS_TOUR_VERSION)}
      ready={boardReady}
      startEvent={START_EVENT}
      idPrefix="ops-tour"
    />
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
