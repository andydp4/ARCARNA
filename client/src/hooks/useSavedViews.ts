import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import type { SavedViewPage, SavedViewRow, ViewState } from "@shared/savedViews/state";

export function useSavedViews(page: SavedViewPage) {
  const queryClient = useQueryClient();
  const queryKey = ["/api/saved-views", page];

  const { data, isLoading } = useQuery<{ views: SavedViewRow[] }>({
    queryKey,
    queryFn: async () => {
      const res = await apiFetch(`/api/saved-views?page=${page}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load views");
      return res.json();
    },
  });

  const views = data?.views ?? [];
  const defaultView = useMemo(() => views.find((v) => v.isDefault) ?? null, [views]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const saveView = useMutation({
    mutationFn: async (payload: { name: string; state: ViewState; isDefault?: boolean }) => {
      const res = await apiFetch("/api/saved-views", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page,
          name: payload.name,
          filters: payload.state.filters,
          sort: payload.state.sort,
          isDefault: payload.isDefault ?? false,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: invalidate,
  });

  const updateView = useMutation({
    mutationFn: async (payload: { id: string; name?: string; isDefault?: boolean }) => {
      const res = await apiFetch(`/api/saved-views/${payload.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(payload.name !== undefined ? { name: payload.name } : {}),
          ...(payload.isDefault !== undefined ? { isDefault: payload.isDefault } : {}),
        }),
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: invalidate,
  });

  const deleteView = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/saved-views/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: invalidate,
  });

  const applyView = useCallback((view: SavedViewRow): ViewState => {
    return {
      filters: (view.filters ?? {}) as Record<string, unknown>,
      sort: (view.sort ?? {}) as ViewState["sort"],
    };
  }, []);

  return {
    views,
    defaultView,
    isLoading,
    saveView,
    updateView,
    deleteView,
    applyView,
  };
}

/** Apply default saved view once on mount when URL has no overrides. */
export function useApplyDefaultView(
  defaultView: SavedViewRow | null,
  onApply: (state: ViewState) => void,
  skip?: boolean,
) {
  useEffect(() => {
    if (skip || !defaultView) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("view") || params.has("q")) return;
    onApply({
      filters: (defaultView.filters ?? {}) as Record<string, unknown>,
      sort: (defaultView.sort ?? {}) as ViewState["sort"],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on load
  }, [defaultView?.id]);
}
