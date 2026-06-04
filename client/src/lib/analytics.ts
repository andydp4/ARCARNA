/**
 * Privacy-conscious product analytics (Plausible). No-op when env unset.
 * Do not send PII in custom props — page paths and coarse events only.
 */

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Record<string, string | number> }) => void;
  }
}

let initialized = false;

function loadPlausibleScript(domain: string): void {
  if (typeof document === "undefined") return;
  const src = "https://plausible.io/js/script.js";
  if (document.querySelector(`script[data-plausible="${domain}"]`)) return;

  const script = document.createElement("script");
  script.defer = true;
  script.dataset.domain = domain;
  script.dataset.plausible = domain;
  script.src = src;
  script.setAttribute("data-api", "https://plausible.io/api/event");
  document.head.appendChild(script);
}

/** Initialize Plausible when VITE_PLAUSIBLE_DOMAIN is set at build time. */
export function initProductAnalytics(): void {
  if (initialized || typeof window === "undefined") return;

  const domain = (import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined)?.trim();
  if (!domain) return;

  loadPlausibleScript(domain);
  initialized = true;
}

/** Track a custom event (no-op without Plausible). */
export function trackEvent(name: string, props?: Record<string, string | number>): void {
  if (!initialized || typeof window.plausible !== "function") return;
  if (props && Object.keys(props).length > 0) {
    window.plausible(name, { props });
  } else {
    window.plausible(name);
  }
}
