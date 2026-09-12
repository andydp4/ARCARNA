export type SavedViewPage = "customers" | "products";

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

export function captureViewState(
  filters: Record<string, unknown>,
  sort: ViewSortState = {},
): ViewState {
  return { filters, sort };
}
