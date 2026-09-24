/**
 * The browser's one usage recorder (v1.2 Phase 8B), and the small calls the
 * rest of the app makes into it: a message shown, a crash, a sale step, the
 * Operations Centre's pane. Every call is a no-op until a member of staff is
 * signed in (and never during "Preview as role").
 */
import {
  STORAGE_USAGE_DEVICE_KEY,
  STORAGE_USAGE_OFFLINE_SINCE,
  STORAGE_USAGE_QUEUE,
} from "@shared/storageKeys";
import type { CrashKind, FunnelStep } from "@shared/usage";
import { APP_VERSION } from "@shared/version";
import { resolveApiUrl } from "../appPaths";
import { withClerkAuthHeaders } from "../clerkApiAuth";
import { getSelectedOrgId } from "../orgScope";
import { deviceName } from "../problemReport";
import { installFetchObserver, UsageRecorder, type KeyValueStore } from "./recorder";

function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export const usageRecorder = new UsageRecorder({
  now: () => Date.now(),
  store: browserStore(),
  queueKey: STORAGE_USAGE_QUEUE,
  deviceKeyKey: STORAGE_USAGE_DEVICE_KEY,
  orgId: () => getSelectedOrgId(),
  device: () => deviceName(),
  appVersion: APP_VERSION,
  online: () => typeof navigator === "undefined" || navigator.onLine,
  send: async (orgId, batch, { keepalive }) => {
    // Org scope only: a role preview is read-only and records nothing.
    const headers = await withClerkAuthHeaders({
      "Content-Type": "application/json",
      ...(orgId ? { "X-Org-Id": orgId } : {}),
    });
    const res = await fetch(resolveApiUrl("/api/usage/events"), {
      method: "POST",
      headers,
      body: JSON.stringify(batch),
      credentials: "include",
      keepalive,
    });
    return res.status;
  },
});

export function recordMessage(title: unknown, variant?: string | null): void {
  usageRecorder.message(title, variant === "destructive" ? "error" : "info");
}

export function recordCrash(kind: CrashKind): void {
  usageRecorder.crash(kind);
}

export function recordFunnel(step: FunnelStep): void {
  usageRecorder.funnel(step);
}

/** The Operations Centre: "order" when the till form is in front, null for the board alone, undefined when leaving. */
export function setUsagePane(pane: "order" | null | undefined): void {
  usageRecorder.setPane(pane);
}

let installed = false;

/**
 * Once per page load, before the app renders: time API calls at fetch
 * itself, count script errors and stale-chunk failures, and time offline
 * spells (kept on the device so a reload while offline still counts).
 */
export function installUsageObservers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  installFetchObserver(window, (method, url, ms, status) => usageRecorder.call(method, url, ms, status));

  window.addEventListener("error", () => usageRecorder.crash("script"));
  window.addEventListener("vite:preloadError", () => usageRecorder.crash("chunk"));

  const store = browserStore();
  const markOffline = () => {
    try {
      if (!store?.getItem(STORAGE_USAGE_OFFLINE_SINCE)) store?.setItem(STORAGE_USAGE_OFFLINE_SINCE, String(Date.now()));
    } catch {
      /* not kept: this spell is not counted */
    }
  };
  const markOnline = () => {
    // Nobody signed in to count it for: kept until someone is (countOfflineSpellOnStart).
    if (!usageRecorder.isEnabled()) return;
    try {
      const since = Number(store?.getItem(STORAGE_USAGE_OFFLINE_SINCE) ?? 0);
      store?.removeItem(STORAGE_USAGE_OFFLINE_SINCE);
      if (since > 0) usageRecorder.offline(Date.now() - since);
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("offline", markOffline);
  window.addEventListener("online", markOnline);
  if (!navigator.onLine) markOffline();
}

/** After sign-in: a spell that ended while nobody was signed in is counted now. */
export function countOfflineSpellOnStart(): void {
  if (typeof navigator === "undefined" || !navigator.onLine) return;
  const store = browserStore();
  try {
    const since = Number(store?.getItem(STORAGE_USAGE_OFFLINE_SINCE) ?? 0);
    if (since > 0) {
      store?.removeItem(STORAGE_USAGE_OFFLINE_SINCE);
      usageRecorder.offline(Date.now() - since);
    }
  } catch {
    /* ignore */
  }
}
