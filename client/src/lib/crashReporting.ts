/**
 * Crash handling shared by the error boundaries and the stale-chunk listener.
 *
 * Kept free of React and of the Sentry SDK so the rules (what counts as a
 * stale-chunk failure, when we are allowed to reload) can be unit tested.
 */

/**
 * After a deploy the old hashed chunks are deleted (vite emptyOutDir), so a
 * till that has been open since before the deploy asks for a file that no
 * longer exists. Browsers word that failure differently; these are the ones
 * seen in the wild for dynamic import / modulepreload / CSS preload.
 */
const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /is not a valid JavaScript MIME type/i,
  /Unable to preload CSS/i,
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
];

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const name = typeof err === "object" && err !== null ? String((err as { name?: unknown }).name ?? "") : "";
  const message =
    typeof err === "string"
      ? err
      : typeof err === "object" && err !== null
        ? String((err as { message?: unknown }).message ?? "")
        : "";
  const text = `${name} ${message}`;
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(text));
}

export const CHUNK_RELOAD_KEY = "arcarna:chunk-reload-at";
/** A second failure inside this window means the reload did not help — stop. */
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

/**
 * Reload the page once for a stale-chunk failure. Returns true when a reload
 * was started, false when we already reloaded recently (so the caller shows
 * the crash card instead of looping). A time window rather than a one-shot
 * flag, so the same tab can recover again after the NEXT deploy.
 */
export function reloadOnceForStaleChunk(
  store: KeyValueStore | null | undefined,
  reload: () => void,
  now: number = Date.now(),
): boolean {
  let last = 0;
  try {
    last = Number(store?.getItem(CHUNK_RELOAD_KEY) ?? 0) || 0;
  } catch {
    // Storage blocked (private mode): without a guard we could loop, so don't reload.
    return false;
  }
  if (!store || (last && now - last < CHUNK_RELOAD_WINDOW_MS)) return false;
  try {
    store.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Browser wiring: reload once via sessionStorage + location.reload. */
export function reloadOnceInBrowser(): boolean {
  if (typeof window === "undefined") return false;
  return reloadOnceForStaleChunk(safeSessionStorage(), () => window.location.reload());
}

/**
 * A short code staff can read out or type in a message. It is also set as the
 * `ref` tag on the Sentry event, so searching `ref:<code>` in Sentry finds it.
 */
export function makeReferenceCode(random: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to misread
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}
