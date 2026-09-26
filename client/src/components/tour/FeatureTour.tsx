import { useMemo } from "react";
import { SpotlightTour } from "@/components/tour/SpotlightTour";
import { requestTourReplay } from "@/components/tour/tourReplay";
import { findTourTarget } from "@/components/tour/tourTarget";
import { featureTourStartEvent, featureToursFor } from "@/components/tour/featureTours";
import { featureTourAccountKey, featureTourLocalKey } from "@shared/uiSeen";

/**
 * The v1.2 feature tours for this page (v1.2 Phase 9), mounted by the Layout
 * beside the Centre tour. Each waits for its feature to be on screen, then
 * takes its turn once nothing else holds the screen (tourScreen.ts).
 */
export function FeatureTours({ path, role }: { path: string; role: string }) {
  const tours = useMemo(() => featureToursFor(path, role), [path, role]);
  return (
    <>
      {tours.map((def) => {
        const key = featureTourAccountKey(def.feature);
        return (
          <SpotlightTour
            key={key}
            steps={def.steps}
            seenKey={key}
            legacyLocalKey={featureTourLocalKey(def.feature)}
            ready
            startEvent={featureTourStartEvent(def.feature)}
            idPrefix={`feature-tour-${def.feature}`}
            anchor={def.anchor}
          />
        );
      })}
    </>
  );
}

/**
 * "Replay tour" on a page whose feature is on screen replays that feature's
 * tour (the page's Centre tour is replayable from the Centre's other pages).
 * Returns false when there is none here, so the caller falls back.
 */
export function replayFeatureTourHere(path: string, role: string | null | undefined): boolean {
  const def = featureToursFor(path, role).find((d) => findTourTarget(d.anchor));
  if (!def) return false;
  requestTourReplay(featureTourStartEvent(def.feature));
  return true;
}
