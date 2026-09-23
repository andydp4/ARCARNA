/**
 * Sentry browser SDK — must load before any other app code.
 * @see https://github.com/getsentry/sentry-for-ai/blob/main/skills/sentry-react-sdk/SKILL.md
 */
import * as Sentry from "@sentry/react";

const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();
const isShopBuild = import.meta.env.VITE_WM_SUPPLIES_CUSTOMER_SITE === "1";
if (dsn) {
  const tracesSampleRate = Math.min(
    1,
    Math.max(0, Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.1)),
  );
  // Replays are recorded only around an error (replaysOnErrorSampleRate), never
  // for whole sessions: recording staff all day, or shop customers at all,
  // needs a notice/consent we do not have, and the plan includes ~50 replays a
  // month which random sampling would burn. The env var stays as an explicit,
  // deliberate opt-in for a short investigation window.
  const replaysSessionSampleRate = isShopBuild
    ? 0
    : Math.min(1, Math.max(0, Number(import.meta.env.VITE_SENTRY_REPLAY_SESSION_RATE ?? 0)));

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || undefined,

    // Retail EPOS: avoid sending user emails/names by default; enable only if you accept Sentry PII policy.
    sendDefaultPii: import.meta.env.VITE_SENTRY_SEND_PII === "1",

    // Replay is deliberately NOT listed here — see the lazy load below.
    integrations: [Sentry.browserTracingIntegration()],

    tracesSampleRate,
    tracePropagationTargets: [
      "localhost",
      /^https:\/\/viger\.cloud/i,
      /^\//,
    ],

    replaysSessionSampleRate,
    replaysOnErrorSampleRate: isShopBuild ? 0 : 1.0,
  });

  // Session Replay is ~250kB raw / ~84kB gzip — the single largest thing in the
  // entry chunk when a DSN is configured. Statically listing it above forced
  // every first paint to download it before the app could start. Fetching it
  // after load keeps error + tracing coverage immediate and moves Replay off
  // the critical path; buffered errors still get a replay attached once it
  // arrives, because replaysOnErrorSampleRate is set above.
  //
  // Deferred to an idle callback so it never competes with first render on a
  // till or a phone on shop wifi.
  const loadReplay = () => {
    Sentry.lazyLoadIntegration("replayIntegration")
      .then((replayIntegration) => {
        Sentry.getClient()?.addIntegration(
          replayIntegration({ maskAllText: true, blockAllMedia: true }),
        );
      })
      .catch(() => {
        // Offline or CDN blocked: error reporting and tracing are unaffected,
        // so degrade quietly rather than surfacing an SDK failure to staff.
      });
  };

  // The shop site never loads Replay at all. The staff build also serves the
  // shop's /order pages and CUSTOMER accounts; App.tsx stops replay there
  // (stopReplayForShopVisitor) once the path or role is known.
  if (!isShopBuild) {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(loadReplay, { timeout: 5000 });
    } else {
      setTimeout(loadReplay, 2000);
    }
  }
}

/** Stop (and never restart) Replay for a shop visitor on the staff build. */
export function stopReplayForShopVisitor(): void {
  try {
    void Sentry.getReplay()?.stop();
  } catch {
    // Replay not loaded / no DSN: nothing is recording.
  }
}

export { Sentry };
