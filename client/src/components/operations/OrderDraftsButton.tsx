import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import { getJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

type DraftRow = { id: string; label: string; updatedAt: string };

function whenSaved(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function OrderDraftsButton({ onResume }: { onResume: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["/api/order-drafts"],
    queryFn: () => getJson<{ drafts: DraftRow[] }>("/api/order-drafts"),
    enabled: open,
    staleTime: 0,
  });

  async function discard(id: string) {
    await apiFetch(`/api/order-drafts/${id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "discarded" }),
    });
    window.dispatchEvent(new CustomEvent("arcarna-draft-discarded", { detail: { id } }));
    await queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
  }

  return (
    <div className="flex flex-col items-end">
      <Button type="button" size="touch" variant="outline" onClick={() => setOpen((v) => !v)} data-testid="button-order-drafts">
        Drafts
      </Button>
      {open && (
        <div
          className="mt-1 w-72 rounded-lg border border-border bg-card p-2 shadow-lg"
          data-testid="order-drafts-panel"
        >
          {list.isLoading && <p className="px-2 py-1 text-sm text-muted-foreground">Loading…</p>}
          {list.isError && <p className="px-2 py-1 text-sm text-destructive">Could not load drafts.</p>}
          {list.data && list.data.drafts.length === 0 && (
            <p className="px-2 py-1 text-sm text-muted-foreground">No saved drafts.</p>
          )}
          <ul className="space-y-1">
            {(list.data?.drafts ?? []).map((draft) => (
              <li key={draft.id} className="flex items-center gap-2">
                <button
                  type="button"
                  className="min-h-11 flex-1 truncate rounded-md px-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    setOpen(false);
                    onResume(draft.id);
                  }}
                >
                  <span className="block truncate">{draft.label || "Draft"}</span>
                  <span className="block text-xs text-muted-foreground">{whenSaved(draft.updatedAt)}</span>
                </button>
                <button type="button" className="min-h-11 px-2 text-sm underline" onClick={() => void discard(draft.id)}>
                  Discard
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
