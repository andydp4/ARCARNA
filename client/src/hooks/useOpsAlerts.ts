import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ackOpsAlert,
  chimeDecisionFor,
  hasChimed,
  isOpsSoundMuted,
  markChimed,
  setOpsSoundMuted,
} from "@/lib/opsAlertsClient";
import { isAudioUnlocked, onAudioUnlocked, playOpsChime, unlockAudio } from "@/lib/posAudio";
import type { OpsAlertKind } from "@shared/orders/opsAlerts";
import { OPS_BOARD_QUERY_KEY, type OpsBoardAlert, type OpsBoardResponse } from "./useOpsBoard";

const ANNOUNCE_KIND_LABEL: Record<OpsAlertKind, string> = {
  assigned: "assigned to you",
  new_unassigned: "unclaimed",
  customer_waiting: "customer waiting",
  due_soon: "due soon",
  late: "running late",
  delayed: "delayed",
};

/**
 * The Operations Centre's per-person alerts — real (Phase N, N5b).
 *
 * N4a's stub always answered `alerts: []` / `isAlertForOrder: () => false`
 * because `ops_alerts` did not exist. It does now (N5a), and
 * `GET /api/orders/board` fills its `alerts` array with the signed-in user's
 * own unacked, unresolved rows for orders currently on the board — this hook
 * reads that array (handed in by `operations.tsx`, which already owns the one
 * `useOpsBoard` call the whole page shares) rather than opening a second
 * `useQuery` subscription of its own.
 *
 * Two things beyond "what is open" live here:
 *
 *  - CHIME, at most one per DELIVERY (brief, "Chime policy"). A "delivery" is
 *    one update of the board's own query data — the reconciliation poll today,
 *    an SSE-triggered refetch or an `invalidateQueries` call from a
 *    transition tomorrow, all indistinguishable from here and all fine to
 *    treat the same way. Alerts already present on the FIRST delivery this
 *    hook ever sees (the tab's own initial load) are deliberately never
 *    "new" — otherwise opening the board would chime once for every alert
 *    already sitting there, which is not what "a new alert arrived" means.
 *    `shared/orders/opsAlerts.ts`'s `chimeFor` picks the kind; this only adds
 *    the id `chimeDecisionFor` (`opsAlertsClient.ts`) resolves it to, so the
 *    cross-tab dedupe set has something concrete to remember.
 *  - ACK, called straight through to the real `PATCH …/alerts/:id/ack`
 *    (N5a) and applied optimistically into the board's own cache entry so the
 *    tray does not wait for the next poll to lose a row the operator just
 *    cleared.
 */

export interface UseOpsAlertsResult {
  /** The signed-in user's own open alerts — real, from the board response. */
  alerts: OpsBoardAlert[];
  /** True while an open alert addressed to the viewer exists on this card. */
  isAlertForOrder(orderId: string): boolean;
  /** Acknowledges one alert server-side; optimistically removes it from the tray on success. */
  ack(id: string): void;
  /** Ids with an ack request currently in flight, so the tray can disable just that button. */
  ackingIds: Set<string>;
  /** The per-device mute preference (`STORAGE_OPS_SOUND`). */
  soundMuted: boolean;
  toggleSound(): void;
  /** Whether the shared `AudioContext` has actually been unlocked by a gesture yet. */
  audioUnlocked: boolean;
}

export function useOpsAlerts(
  alerts: OpsBoardAlert[],
  now: Date,
  /** The board's one `role="status"` announcer (`OpsAnnouncer`) — a sentence per new alert. */
  onAnnounce?: (message: string) => void,
): UseOpsAlertsResult {
  const queryClient = useQueryClient();
  const seenIdsRef = useRef<Set<string> | null>(null);
  const [ackingIds, setAckingIds] = useState<Set<string>>(() => new Set());
  const [soundMuted, setSoundMutedState] = useState<boolean>(() => isOpsSoundMuted());
  const [audioUnlocked, setAudioUnlocked] = useState<boolean>(() => isAudioUnlocked());

  // `now` ticks every second (`useOpsTicker`) purely so `chimeDecisionFor` can
  // apply the 2-minute age cutoff at the instant a delivery is actually
  // processed below — it is read from this ref, not a dependency, so the
  // delivery effect only re-runs when `alerts` itself changes, not once a
  // second for a board that has nothing new to report.
  const nowRef = useRef(now);
  nowRef.current = now;

  // Arms the gesture listeners once per mount; harmless (and a no-op) to call
  // again from a second mount, or after the context is already running.
  useEffect(() => {
    unlockAudio();
    return onAudioUnlocked(() => setAudioUnlocked(true));
  }, []);

  useEffect(() => {
    const currentIds = new Set(alerts.map((a) => a.id));
    const previous = seenIdsRef.current;
    seenIdsRef.current = currentIds;
    if (!previous) return; // this tab's first delivery — its whole starting set is the baseline, not "new"

    const delivered = alerts.filter((a) => !previous.has(a.id));
    if (delivered.length === 0) return;

    // The announcer gets a sentence regardless of sound or chime dedupe — the
    // pulse and its text are the primary channel (brief: "the pulse and text
    // are always the primary channel"), audio is only ever a supplement to it.
    onAnnounce?.(
      delivered.length === 1
        ? `New alert: ${ANNOUNCE_KIND_LABEL[delivered[0].kind]}`
        : `${delivered.length} new alerts`,
    );

    const decision = chimeDecisionFor(delivered, nowRef.current);
    if (!decision) return;
    if (hasChimed(decision.alertId)) return; // another tab of this browser already chimed for this row
    markChimed(decision.alertId);
    if (!soundMuted) playOpsChime(decision.kind);
  }, [alerts, soundMuted, onAnnounce]);

  const isAlertForOrder = useCallback((orderId: string) => alerts.some((a) => a.orderId === orderId), [alerts]);

  const removeFromCache = useCallback(
    (id: string) => {
      queryClient.setQueryData<OpsBoardResponse>(OPS_BOARD_QUERY_KEY, (current) =>
        current ? { ...current, alerts: current.alerts.filter((a) => a.id !== id) } : current,
      );
    },
    [queryClient],
  );

  const ack = useCallback(
    (id: string) => {
      setAckingIds((current) => new Set(current).add(id));
      ackOpsAlert(id)
        .then(() => removeFromCache(id))
        .catch(() => {
          // Left in the tray — the next poll is the source of truth either
          // way, and a silent retry-later beats a toast for a background ack.
        })
        .finally(() => {
          setAckingIds((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        });
    },
    [removeFromCache],
  );

  const toggleSound = useCallback(() => {
    setSoundMutedState((current) => {
      const next = !current;
      setOpsSoundMuted(next);
      return next;
    });
  }, []);

  return useMemo(
    () => ({ alerts, isAlertForOrder, ack, ackingIds, soundMuted, toggleSound, audioUnlocked }),
    [alerts, isAlertForOrder, ack, ackingIds, soundMuted, toggleSound, audioUnlocked],
  );
}
