/**
 * Truths at a glance (v1.2 Phase 3): the Truths Centre's landing page.
 *
 * One layout for the whole org, set by admins (owner decision). Everyone
 * else sees it read-only, minus the widgets their role may not see — the
 * server removes those before the layout reaches them. Today's Truths Hub
 * charts (/insights, which now redirects here) are the default layout.
 *
 * The editor uses native <select>s and inline buttons, not popovers or
 * dialogs, so it works one-handed on a phone with nothing floating over it.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, Download, LayoutGrid, MessageCircleQuestion, Pencil, Plus, Save, Trash2, TrendingUp, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useAskStatus } from "@/components/ask/AskPanel";
import { openAskPanel } from "@/lib/ask";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { ActionLoader } from "@/components/action-loader";
import { TruthsWidgetCard } from "@/components/truths/TruthsWidgets";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useMediaQuery } from "@/hooks/use-media-query";
import { apiFetch } from "@/lib/appPaths";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { EXPORT_MIN_ROLE, isAtLeast } from "@shared/accessPolicy";
import {
  TRUTHS_LAYOUT_EDIT_MIN_ROLE,
  TRUTHS_LAYOUT_MAX_WIDGETS,
  TRUTHS_WINDOWS,
  WIDGET_SIZES,
  WIDGET_SIZE_LABEL,
  addableWidgets,
  truthsWidget,
  windowRange,
  type TruthsLayout,
  type TruthsWindow,
  type WidgetGroup,
  type WidgetSize,
} from "@shared/truthsLayout";

type LayoutResponse = { widgets: TruthsLayout; isDefault: boolean; updatedAt: string | null };

const LAYOUT_KEY = ["/api/truths/layout"];

const GROUP_LABEL: Record<WidgetGroup, string> = {
  truth: "Truths",
  evidence: "Evidence",
  guide: "Guides",
};

const SELECT_CLASS =
  "min-h-[40px] w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export default function TruthsAtAGlance() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isPhone = useMediaQuery("(max-width: 639px)");
  const canEdit = isAtLeast(user?.role, TRUTHS_LAYOUT_EDIT_MIN_ROLE);
  const [draft, setDraft] = useState<TruthsLayout | null>(null);
  const editing = draft !== null;

  const { data, isLoading, isError, refetch } = useQuery<LayoutResponse>({
    queryKey: LAYOUT_KEY,
    queryFn: async () => {
      const res = await apiFetch("/api/truths/layout", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load Truths at a glance");
      return res.json();
    },
  });

  const save = useMutation({
    mutationFn: async (widgets: TruthsLayout) => (await apiRequest("PUT", "/api/truths/layout", { widgets })).json(),
    onSuccess: (saved: LayoutResponse) => {
      queryClient.setQueryData(LAYOUT_KEY, saved);
      setDraft(null);
      toast({ title: "Layout saved", description: "Everyone in the org now sees this layout." });
    },
    onError: (e: Error) => toast({ title: "Couldn't save the layout", description: e.message, variant: "destructive" }),
  });

  const shown = draft ?? data?.widgets ?? [];
  const askEnabled = useAskStatus().data?.enabled === true;

  const header = (
    <PageHeader
      icon={TrendingUp}
      title="Truths at a glance"
      question="What should you know about your business right now?"
      explanation={
        canEdit
          ? "The whole org sees this layout. Add, order and size widgets with Edit layout."
          : "Your admin chose these widgets. Each one says which window it covers."
      }
      action={
        askEnabled || (canEdit && !editing) ? (
          <div className="flex flex-wrap gap-2">
            {askEnabled && (
              <Button variant="outline" className="min-h-[44px] gap-2" onClick={() => openAskPanel()} data-testid="button-truths-ask">
                <MessageCircleQuestion className="h-4 w-4" aria-hidden />
                Ask arcarna
              </Button>
            )}
            {canEdit && !editing && (
              <Button
                variant="outline"
                className="min-h-[44px] gap-2"
                onClick={() => setDraft(data?.widgets ?? [])}
                disabled={!data}
                data-testid="button-edit-truths-layout"
              >
                <Pencil className="h-4 w-4" aria-hidden />
                Edit layout
              </Button>
            )}
          </div>
        ) : undefined
      }
    />
  );

  return (
    <div className="w-full">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {header}

        {canEdit && editing && (
          <LayoutEditorBar
            draft={draft!}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSave={() => save.mutate(draft!)}
            saving={save.isPending}
          />
        )}

        {isError ? (
          <ErrorState
            title="Couldn't load Truths at a glance"
            body="The layout failed to load. Try again."
            onRetry={() => refetch()}
            data-testid="truths-layout-error"
          />
        ) : isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="truths-layout-empty">
            {canEdit ? "No widgets yet. Choose Edit layout to add some." : "Your admin hasn't placed any widgets here yet."}
          </p>
        ) : (
          // Phones: one column. md: two. lg: a six-column grid that small /
          // medium / large widgets span a third / half / all of.
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6" data-testid="truths-layout-grid">
            {shown.map((entry, index) => (
              <TruthsWidgetCard
                key={entry.id}
                entry={entry}
                isPhone={isPhone}
                controls={
                  editing ? (
                    <WidgetControls
                      index={index}
                      count={shown.length}
                      size={entry.size}
                      window={entry.window}
                      windows={truthsWidget(entry.id)?.windows ?? []}
                      label={truthsWidget(entry.id)?.label ?? entry.id}
                      onMove={(to) => setDraft(move(shown, index, to))}
                      onSize={(size) => setDraft(shown.map((e, i) => (i === index ? { ...e, size } : e)))}
                      onWindow={(w) => setDraft(shown.map((e, i) => (i === index ? { ...e, window: w } : e)))}
                      onRemove={() => setDraft(shown.filter((_, i) => i !== index))}
                    />
                  ) : undefined
                }
              />
            ))}
          </div>
        )}

        {!editing && data && !data.isDefault && data.updatedAt && (
          <p className="mt-6 text-xs text-muted-foreground">Layout last changed {format(new Date(data.updatedAt), "d MMM yyyy, HH:mm")}.</p>
        )}

        {isAtLeast(user?.role, EXPORT_MIN_ROLE) && !editing && <FullExport />}
      </div>
    </div>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function LayoutEditorBar({
  draft,
  onChange,
  onCancel,
  onSave,
  saving,
}: {
  draft: TruthsLayout;
  onChange: (next: TruthsLayout) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const options = addableWidgets(draft);
  const [pick, setPick] = useState("");
  const full = draft.length >= TRUTHS_LAYOUT_MAX_WIDGETS;
  const groups = useMemo(() => {
    const out: Partial<Record<WidgetGroup, typeof options>> = {};
    for (const o of options) (out[o.group] ??= []).push(o);
    return out;
  }, [options]);

  const add = () => {
    const def = truthsWidget(pick);
    if (!def) return;
    onChange([...draft, { id: def.id, size: def.defaultSize, window: def.windows[0] }]);
    setPick("");
  };

  return (
    <div className="mb-6 space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-4" data-testid="truths-layout-editor">
      <p className="text-sm">
        <span className="font-semibold">Editing the org's layout.</span> Widgets a viewer's role may not see are hidden from
        them (Profit Truths is admins only). Saving is logged.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 space-y-1 text-xs font-medium text-muted-foreground">
          Add a widget
          <select
            className={SELECT_CLASS}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            disabled={full || options.length === 0}
            data-testid="select-add-truths-widget"
          >
            <option value="">{full ? `At most ${TRUTHS_LAYOUT_MAX_WIDGETS} widgets` : "Choose a Truth or Evidence…"}</option>
            {(Object.keys(GROUP_LABEL) as WidgetGroup[]).map((g) =>
              groups[g]?.length ? (
                <optgroup key={g} label={GROUP_LABEL[g]}>
                  {groups[g]!.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                      {o.minRole === "ADMIN" ? " (admins only)" : ""}
                    </option>
                  ))}
                </optgroup>
              ) : null,
            )}
          </select>
        </label>
        <Button onClick={add} disabled={!pick} className="min-h-[40px] gap-2" data-testid="button-add-truths-widget">
          <Plus className="h-4 w-4" aria-hidden />
          Add widget
        </Button>
      </div>
      {pick && <p className="text-xs text-muted-foreground">{truthsWidget(pick)?.description}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onSave} disabled={saving} className="min-h-[44px] gap-2" data-testid="button-save-truths-layout">
          {saving ? <ActionLoader className="text-primary-foreground" /> : <Save className="h-4 w-4" aria-hidden />}
          Save layout
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saving} className="min-h-[44px] gap-2" data-testid="button-cancel-truths-layout">
          <X className="h-4 w-4" aria-hidden />
          Cancel
        </Button>
      </div>
    </div>
  );
}

function WidgetControls({
  index,
  count,
  size,
  window,
  windows,
  label,
  onMove,
  onSize,
  onWindow,
  onRemove,
}: {
  index: number;
  count: number;
  size: WidgetSize;
  window: TruthsWindow;
  windows: readonly TruthsWindow[];
  label: string;
  onMove: (to: number) => void;
  onSize: (s: WidgetSize) => void;
  onWindow: (w: TruthsWindow) => void;
  onRemove: () => void;
}) {
  return (
    <div className="mt-3 space-y-2 border-t pt-3" data-testid={`truths-widget-controls-${index}`}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          Size
          <select className={SELECT_CLASS} value={size} onChange={(e) => onSize(e.target.value as WidgetSize)} aria-label={`Size of ${label}`}>
            {WIDGET_SIZES.map((s) => (
              <option key={s} value={s}>
                {WIDGET_SIZE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          Window
          <select
            className={SELECT_CLASS}
            value={window}
            onChange={(e) => onWindow(e.target.value as TruthsWindow)}
            disabled={windows.length < 2}
            aria-label={`Window of ${label}`}
          >
            {windows.map((w) => (
              <option key={w} value={w}>
                {TRUTHS_WINDOWS[w]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="min-h-[40px] gap-1" onClick={() => onMove(index - 1)} disabled={index === 0}>
          <ArrowUp className="h-4 w-4" aria-hidden />
          Move up
        </Button>
        <Button size="sm" variant="outline" className="min-h-[40px] gap-1" onClick={() => onMove(index + 1)} disabled={index === count - 1}>
          <ArrowDown className="h-4 w-4" aria-hidden />
          Move down
        </Button>
        <Button size="sm" variant="destructive" className="min-h-[40px] gap-1" onClick={onRemove} data-testid={`button-remove-truths-widget-${index}`}>
          <Trash2 className="h-4 w-4" aria-hidden />
          Remove
        </Button>
      </div>
    </div>
  );
}

const EXPORT_WINDOWS: TruthsWindow[] = ["month", "today", "week", "last30", "quarter", "year"];

/**
 * The Truths Hub's "Download full report", kept for admins now the hub is
 * widgets. Exports are admin only and logged on the server (Q12).
 */
function FullExport() {
  const { toast } = useToast();
  const [window, setWindow] = useState<TruthsWindow>("month");
  const [fmt, setFmt] = useState<"csv" | "pdf">("csv");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const range = windowRange(window)!;
    setBusy(true);
    try {
      const params = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString(), format: fmt, type: "full" });
      const res = await apiRequest("GET", `/api/reports/export?${params}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `full_report_${format(range.from, "yyyy-MM-dd")}_${format(range.to, "yyyy-MM-dd")}.${fmt}`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Report exported", description: `Downloaded as ${fmt.toUpperCase()}.` });
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message || "Failed to export report", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lm-card mt-8 rounded-xl p-4" data-testid="truths-full-export">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <LayoutGrid className="h-4 w-4" aria-hidden /> Full report export
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Revenue, orders, customers and stock for a window. Admins only; every export is logged.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="space-y-1 text-xs font-medium text-muted-foreground sm:w-48">
          Window
          <select className={SELECT_CLASS} value={window} onChange={(e) => setWindow(e.target.value as TruthsWindow)} data-testid="select-export-window">
            {EXPORT_WINDOWS.map((w) => (
              <option key={w} value={w}>
                {TRUTHS_WINDOWS[w]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground sm:w-32">
          Format
          <select className={SELECT_CLASS} value={fmt} onChange={(e) => setFmt(e.target.value as "csv" | "pdf")} data-testid="select-export-format">
            <option value="csv">CSV</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Button onClick={run} disabled={busy} className="min-h-[44px] gap-2" data-testid="button-export-full">
          {busy ? <ActionLoader className="text-primary-foreground" /> : <Download className="h-4 w-4" aria-hidden />}
          Download full report
        </Button>
      </div>
    </section>
  );
}
