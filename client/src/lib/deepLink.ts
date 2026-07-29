/**
 * Query-string helpers for the replenishment → purchase draft → receiving flow.
 *
 * Each hop in that flow hands off a specific record (a draft that was just
 * created, a receipt to complete). Carrying the id in the URL keeps those links
 * navigable and shareable instead of dropping the user on a list to hunt.
 */

export function readQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** Builds a path with the given params, omitting empty values. */
export function withQuery(path: string, params: Record<string, string | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Removes params from the current URL without adding a history entry, so a
 * consumed deep link does not re-open its dialog on back-navigation or refresh.
 */
export function clearQueryParams(names: string[]) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const name of names) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name);
      changed = true;
    }
  }
  if (changed) {
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
}

export const INVENTORY_TABS = ["stock", "smart", "replenishment", "receiving", "transfers"] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number];

export function isInventoryTab(value: string | null): value is InventoryTab {
  return !!value && (INVENTORY_TABS as readonly string[]).includes(value);
}

/** Link to a goods receipt, landing on the Receiving tab with its detail open. */
export function receiptLink(receiptId: string) {
  return withQuery("/inventory", { tab: "receiving", receipt: receiptId });
}

/** Link to a purchase draft, landing on the drafts list with its detail open. */
export function purchaseDraftLink(draftId: string) {
  return withQuery("/purchase-drafts", { draft: draftId });
}
