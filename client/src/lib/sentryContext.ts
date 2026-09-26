/**
 * Sentry tags every event carries (v1.2 Phase 8A, UXA-14): role, screen and
 * device. None of them names a person, and screen is the route shape (ids and
 * query strings removed), never the raw URL. With no DSN configured these
 * calls are no-ops.
 */
import { Sentry } from "@/instrument";

export function setSentryContextTags(tags: { role: string | null | undefined; screen: string; device: string }): void {
  try {
    Sentry.setTags({ role: tags.role || "unknown", screen: tags.screen, device: tags.device });
  } catch {
    /* Sentry not loaded: nothing to tag */
  }
}

/**
 * Owner decision Q18(c): a recording is sent when staff press Problem? (as on
 * a crash), and only the last minute or so the replay SDK keeps in memory. It
 * then goes back to buffering, rather than recording the rest of the shift.
 */
export async function sendReplayForProblem(problemId: string): Promise<void> {
  try {
    const replay = Sentry.getReplay();
    if (!replay) return;
    Sentry.setTag("problem_id", problemId);
    await replay.flush({ continueRecording: false });
    await replay.stop({ flush: false });
    replay.startBuffering();
  } catch {
    /* Replay not loaded, offline, or blocked: the report itself has been sent */
  } finally {
    try {
      Sentry.setTag("problem_id", undefined);
    } catch {
      /* ignore */
    }
  }
}
