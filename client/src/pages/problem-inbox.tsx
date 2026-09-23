/**
 * The Problem? inbox (v1.2 Phase 8A, UXA-09): what staff reported with the
 * "Problem?" button. Admins and the owner only, on the server as well.
 *
 * Each report shows the reporter's role, never their name (owner decision
 * Q18). Marking one fixed takes the version it is fixed in, and the reporter
 * gets "Thanks, fixed in version X" in their Signals bell.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LifeBuoy } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getJson, queryClient } from "@/lib/queryClient";
import { VERSION_RE, type ProblemStatus } from "@shared/problemReports";
import { APP_VERSION } from "@shared/version";

type Report = {
  id: string;
  chip: string;
  chipLabel: string;
  note: string | null;
  screen: string;
  role: string;
  device: string;
  appVersion: string | null;
  online: boolean;
  queue: { waiting: number; failed: number; needsAttention: number };
  status: ProblemStatus;
  fixedInVersion: string | null;
  resolvedAt: string | null;
  reportedAt: string | null;
  createdAt: string;
};

const STATUS_LABEL: Record<ProblemStatus, string> = { open: "Open", fixed: "Fixed", closed: "Closed" };

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function roleLabel(role: string): string {
  return role.toLowerCase().replace(/_/g, " ");
}

function ReportCard({ report }: { report: Report }) {
  const { toast } = useToast();
  const [version, setVersion] = useState(report.fixedInVersion ?? APP_VERSION);
  const versionOk = VERSION_RE.test(version.trim());
  const resolve = useMutation({
    mutationFn: async (body: { outcome: "fixed"; version: string } | { outcome: "closed" | "open" }) =>
      (await apiRequest("POST", `/api/problem-reports/${report.id}/resolve`, body)).json() as Promise<{ thanked: boolean }>,
    onSuccess: (out, body) => {
      queryClient.invalidateQueries({ queryKey: ["/api/problem-reports"] });
      toast({
        title: body.outcome === "fixed" ? "Marked fixed" : body.outcome === "closed" ? "Closed" : "Reopened",
        description: out.thanked ? "The person who reported it has been thanked with the version." : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });
  const q = report.queue;

  return (
    <Card className="lm-card border-0 shadow-none" data-testid={`problem-report-${report.id}`}>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={report.chip === "error_message" ? "destructive" : "secondary"}>{report.chipLabel}</Badge>
          <Badge variant="outline">
            {STATUS_LABEL[report.status]}
            {report.status === "fixed" && report.fixedInVersion ? ` in ${report.fixedInVersion}` : ""}
          </Badge>
          <span className="text-xs text-muted-foreground">{when(report.reportedAt ?? report.createdAt)}</span>
        </div>
        {report.note && <p className="whitespace-pre-wrap text-sm">{report.note}</p>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Screen</dt>
            <dd className="break-all">{report.screen}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Role</dt>
            <dd className="capitalize">{roleLabel(report.role)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Device</dt>
            <dd>{report.device}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Version</dt>
            <dd>{report.appVersion ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Connection</dt>
            <dd>{report.online ? "Online" : "Offline"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Sales</dt>
            <dd>
              {q.waiting} waiting · {q.failed} failed · {q.needsAttention} on Needs attention
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`version-${report.id}`} className="text-xs">
              Fixed in version
            </Label>
            <Input
              id={`version-${report.id}`}
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="min-h-[44px] w-[140px]"
              data-testid={`input-problem-version-${report.id}`}
            />
          </div>
          <Button
            size="sm"
            className="min-h-[44px]"
            disabled={resolve.isPending || !versionOk}
            onClick={() => resolve.mutate({ outcome: "fixed", version: version.trim() })}
            data-testid={`button-problem-fixed-${report.id}`}
          >
            Mark fixed and thank them
          </Button>
          {report.status !== "closed" && (
            <Button
              size="sm"
              variant="outline"
              className="min-h-[44px]"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ outcome: "closed" })}
              data-testid={`button-problem-close-${report.id}`}
            >
              Close without a fix
            </Button>
          )}
          {report.status !== "open" && (
            <Button size="sm" variant="ghost" className="min-h-[44px]" disabled={resolve.isPending} onClick={() => resolve.mutate({ outcome: "open" })}>
              Reopen
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProblemInboxPage() {
  const [status, setStatus] = useState<ProblemStatus | "all">("open");
  const { data, isLoading, isError } = useQuery<Report[]>({
    queryKey: ["/api/problem-reports", status],
    queryFn: () => getJson(`/api/problem-reports?status=${status}`),
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        icon={LifeBuoy}
        title="Problem? inbox"
        question="Where are staff getting stuck?"
        explanation="What staff reported with the Problem? button, with the screen, device, version and whether the till was online. You see their role, not their name. Mark one fixed with the version and they are thanked."
      />

      <div className="space-y-1">
        <Label className="text-xs">Show</Label>
        <Select value={status} onValueChange={(v) => setStatus(v as ProblemStatus | "all")}>
          <SelectTrigger className="min-h-[44px] w-[180px]" data-testid="select-problem-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="fixed">Fixed</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isError && <p className="text-sm text-destructive">Could not load the inbox. Try again.</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="text-problem-inbox-empty">
          Nothing reported here.
        </p>
      )}
      <div className="space-y-3">
        {data?.map((r) => <ReportCard key={r.id} report={r} />)}
      </div>
    </div>
  );
}
