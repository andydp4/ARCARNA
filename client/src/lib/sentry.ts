/** @deprecated Import ../instrument.ts first in main.tsx; re-export for existing imports. */
export { Sentry } from "../instrument";

/** No-op — init runs when instrument.ts is imported. */
export function initSentry(): void {}
