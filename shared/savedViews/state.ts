export type SavedViewPage = "customers" | "products" | "orders";

export type ViewSortState = {
  column?: string;
  direction?: "asc" | "desc";
};

export type ViewState = {
  filters: Record<string, unknown>;
  sort: ViewSortState;
};

export type SavedViewRow = {
  id: string;
  page: string;
  name: string;
  filters: Record<string, unknown>;
  sort: ViewSortState;
  isDefault: boolean;
};

/** Merge saved view filters into current page state shape. */
export function applyViewState<T extends Record<string, unknown>>(
  view: ViewState,
  defaults: T,
  keyMap?: Record<string, keyof T>,
): T {
  const next = { ...defaults };
  for (const [key, value] of Object.entries(view.filters)) {
    const target = keyMap?.[key] ?? (key as keyof T);
    if (target in next) {
      (next as Record<string, unknown>)[target as string] = value;
    }
  }
  return next;
}

export function captureViewState(
  filters: Record<string, unknown>,
  sort: ViewSortState = {},
): ViewState {
  return { filters, sort };
}
