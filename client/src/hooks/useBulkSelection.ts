import { useCallback, useMemo, useState } from "react";

export function useBulkSelection<T extends { id: string }>(items: T[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const visibleIds = items.map((i) => i.id);
      const allSelected = visibleIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      return new Set([...prev, ...visibleIds]);
    });
  }, [items]);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const selected = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );

  const allVisibleSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));

  return {
    selectedIds,
    selected,
    count: selectedIds.size,
    toggle,
    toggleAllVisible,
    clear,
    isSelected: (id: string) => selectedIds.has(id),
    allVisibleSelected,
  };
}
