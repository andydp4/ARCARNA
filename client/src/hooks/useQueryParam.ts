import { useMemo, useSyncExternalStore } from "react";

const QUERY_CHANGE_EVENT = "arcarna:querychange";
let historyPatched = false;

function emitQueryChange() {
  window.dispatchEvent(new Event(QUERY_CHANGE_EVENT));
}

function patchHistory() {
  if (historyPatched || typeof window === "undefined") return;
  historyPatched = true;

  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method];
    window.history[method] = function patchedHistoryMethod(
      this: History,
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ) {
      const result = original.call(this, data, unused, url);
      emitQueryChange();
      return result;
    } as typeof original;
  }
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  patchHistory();
  window.addEventListener(QUERY_CHANGE_EVENT, onStoreChange);
  window.addEventListener("popstate", onStoreChange);
  return () => {
    window.removeEventListener(QUERY_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("popstate", onStoreChange);
  };
}

function getSnapshot() {
  return typeof window === "undefined" ? "" : window.location.search;
}

export function useQueryParam(name: string): string | null {
  const search = useSyncExternalStore(subscribe, getSnapshot, () => "");
  return useMemo(() => new URLSearchParams(search).get(name), [name, search]);
}
