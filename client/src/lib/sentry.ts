import * as Sentry from "@sentry/react";

/** Initialize browser error reporting when VITE_SENTRY_DSN is set at build time. */
export function initSentry(): void {
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: Math.min(
      1,
      Math.max(0, Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0)),
    ),
  });
}
