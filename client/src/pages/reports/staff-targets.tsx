/**
 * Staff targets (v1.2 Phase 7C, STF-07/STF-08).
 *
 * Everyone can read the targets behind their colours. Only admins can change
 * them (the server refuses anyone else), and every save is a new, logged
 * version — the history is listed below. Only rates and percentages can have
 * a target. There is no money on this page: the old £50/£100/£150 bonus
 * tiers are gone and nothing here is linked to pay (Q16).
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, Target } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getJson, queryClient } from "@/lib/queryClient";
import { AMBER_ONLY_DAYS, TARGET_METRICS, TARGET_METRIC_KEYS, type StaffTarget, type TargetMetric } from "@shared/reports/staffTargets";

type Version = { version: number; targets: StaffTarget[]; note: string | null; setByUserId: string; setAt: string };
type TargetsResponse = { current: Version | null; firstSetAt: string | null; canEdit: boolean; history: Version[] };
type Draft = Record<TargetMetric, { on: boolean; green: string; amber: string; minData: string }>;

function draftFrom(current: Version | null): Draft {
  const out = {} as Draft;
  for (const key of TARGET_METRIC_KEYS) {
    const t = current?.targets.find((x) => x.metric === key);
    out[key] = { on: Boolean(t), green: t ? String(t.green) : "", amber: t ? String(t.amber) : "", minData: t?.minData ? String(t.minData) : "" };
  }
  return out;
}

const describe = (t: StaffTarget) => {
  const def = TARGET_METRICS[t.metric];
  const word = def.better === "higher" ? "at least" : "at most";
  return `${def.label}: green ${word} ${t.green}${def.unit === "%" ? "%" : ` ${def.unit}`}, amber ${word} ${t.amber}`;
};

export default function StaffTargetsPage() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<TargetsResponse>({
    queryKey: ["/api/staff-targets"],
    queryFn: () => getJson("/api/staff-targets"),
  });
  const [draft, setDraft] = useState<Draft>(() => draftFrom(null));
  const [note, setNote] = useState("");
  useEffect(() => {
    if (data) setDraft(draftFrom(data.current));
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      for (const k of TARGET_METRIC_KEYS) {
        if (!draft[k].on) continue;
        const def = TARGET_METRICS[k];
        if (!Number.isFinite(Number(draft[k].green)) || draft[k].green.trim() === "") {
          throw new Error(`${def.label}: enter a green value.`);
        }
        if (!Number.isFinite(Number(draft[k].amber)) || draft[k].amber.trim() === "") {
          throw new Error(`${def.label}: enter an amber value.`);
        }
        if (draft[k].minData.trim() !== "" && !Number.isFinite(Number(draft[k].minData))) {
          throw new Error(`${def.label}: "data needed" must be a number.`);
        }
      }
      const targets = TARGET_METRIC_KEYS.filter((k) => draft[k].on).map((k) => ({
        metric: k,
        green: Number(draft[k].green),
        amber: Number(draft[k].amber),
        ...(draft[k].minData.trim() ? { minData: Number(draft[k].minData) } : {}),
      }));
      const res = await apiRequest("PUT", "/api/staff-targets", { targets, ...(note.trim() ? { note: note.trim() } : {}) });
      return res.json();
    },
    onSuccess: (saved: Version) => {
      toast({ title: `Targets saved as version ${saved.version}` });
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["/api/staff-targets"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/evidence/staff-performance"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/my-performance"] });
    },
    onError: (e: Error) => toast({ title: "Could not save the targets", description: e.message, variant: "destructive" }),
  });

  const set = (k: TargetMetric, patch: Partial<Draft[TargetMetric]>) => setDraft((d) => ({ ...d, [k]: { ...d[k], ...patch } }));

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Link href="/reports/staff-performance" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Staff Performance
      </Link>
      <PageHeader
        icon={Target}
        title="Staff targets"
        question="What counts as on track?"
        explanation={`Green is met, amber is close, red is not close, grey is too little data. KPIs met is greens over targets with enough data. For the first ${AMBER_ONLY_DAYS / 7} weeks after targets are first set nothing shows red. Targets carry no pay.`}
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {data && (
        <Card className="lm-card border-0 shadow-none">
          <CardHeader>
            <CardTitle>In force</CardTitle>
            <CardDescription>
              {data.current
                ? `Version ${data.current.version}, set ${new Date(data.current.setAt).toLocaleString("en-GB")}.`
                : "No targets have been set yet, so every colour is grey."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm" data-testid="list-targets-current">
              {(data.current?.targets ?? []).map((t) => <li key={t.metric}>{describe(t)}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      {data?.canEdit && (
        <Card className="lm-card border-0 shadow-none">
          <CardHeader>
            <CardTitle>Change the targets</CardTitle>
            <CardDescription>Saving writes a new version; the old one stays in the history and in the admin log.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {TARGET_METRIC_KEYS.map((k) => {
              const def = TARGET_METRICS[k];
              return (
                <div key={k} className="flex flex-wrap items-end gap-3" data-testid={`target-row-${k}`}>
                  <div className="flex min-h-[44px] w-64 items-center gap-2">
                    <Checkbox id={`t-${k}`} checked={draft[k].on} onCheckedChange={(v) => set(k, { on: v === true })} />
                    <Label htmlFor={`t-${k}`}>{def.label}</Label>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Green {def.better === "higher" ? "at least" : "at most"}</Label>
                    <Input aria-label={`${def.label}: green ${def.better === "higher" ? "at least" : "at most"}`} className="w-24" inputMode="decimal" value={draft[k].green} disabled={!draft[k].on} onChange={(e) => set(k, { green: e.target.value })} data-testid={`input-target-green-${k}`} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Amber {def.better === "higher" ? "at least" : "at most"}</Label>
                    <Input aria-label={`${def.label}: amber ${def.better === "higher" ? "at least" : "at most"}`} className="w-24" inputMode="decimal" value={draft[k].amber} disabled={!draft[k].on} onChange={(e) => set(k, { amber: e.target.value })} data-testid={`input-target-amber-${k}`} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Data needed (default {def.defaultMinData})</Label>
                    <Input aria-label={`${def.label}: data needed`} className="w-24" inputMode="numeric" value={draft[k].minData} disabled={!draft[k].on} onChange={(e) => set(k, { minData: e.target.value })} />
                  </div>
                  <span className="pb-2 text-xs text-muted-foreground">{def.unit}</span>
                </div>
              );
            })}
            <div className="space-y-1">
              <Label htmlFor="targets-note">Why the change (optional)</Label>
              <Input id="targets-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </div>
            <Button onClick={() => save.mutate()} disabled={save.isPending} className="min-h-[44px]" data-testid="button-save-targets">
              Save as a new version
            </Button>
          </CardContent>
        </Card>
      )}

      {data?.canEdit && data.history.length > 0 && (
        <Card className="lm-card border-0 shadow-none">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Set</TableHead>
                  <TableHead>Targets</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.history.map((v) => (
                  <TableRow key={v.version}>
                    <TableCell>{v.version}</TableCell>
                    <TableCell className="whitespace-nowrap">{new Date(v.setAt).toLocaleString("en-GB")}</TableCell>
                    <TableCell className="text-xs">{v.targets.map(describe).join("; ") || "None"}</TableCell>
                    <TableCell className="text-xs">{v.note ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
