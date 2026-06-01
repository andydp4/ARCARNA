/**
 * Sentry browser SDK — must load before any other app code.
 * @see https://github.com/getsentry/sentry-for-ai/blob/main/skills/sentry-react-sdk/SKILL.md
 */
import * as Sentry from "@sentry/react";

const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();
if (dsn) {
  const tracesSampleRate = Math.min(
    1,
    Math.max(0, Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.1)),
  );
  const replaysSessionSampleRate = Math.min(
    1,
    Math.max(0, Number(import.meta.env.VITE_SENTRY_REPLAY_SESSION_RATE ?? 0.1)),
  );

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || undefined,

    // Retail EPOS: avoid sending user emails/names by default; enable only if you accept Sentry PII policy.
    sendDefaultPii: import.meta.env.VITE_SENTRY_SEND_PII === "1",

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    tracesSampleRate,
    tracePropagationTargets: [
      "localhost",
      /^https:\/\/viger\.cloud/i,
      /^\//,
    ],

    replaysSessionSampleRate,
    replaysOnErrorSampleRate: 1.0,
  });
}

export { Sentry };
