/**
 * Friction Truths (v1.2 Phase 8B, UXA-07/08): where staff get stuck, from our
 * own usage record. The owner's alone (Q18), on the server as well.
 *
 * Everything here is by screen, role and device, never by person, and it is
 * not for staff reviews. For the first two weeks it says "not enough data
 * yet" instead of ranking: a few hours make any screen look terrible.
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Gauge, LifeBuoy } from "lucide-react";
import { LM_CARD, PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getJson, queryClient } from "@/lib/queryClient";
import {
  FUNNEL_STEPS,
  INFORMATION_SCREEN_LABEL,
  SLOW_CALL_MS,
  STUDY_MAX_DAYS,
  STUDY_MAX_SCREENS,
  type StudyWindow,
} from "@shared/usage";
import { localIsoDate } from "@shared/orders/orderDate";
import { shiftIsoDate } from "@shared/time/tradingDay";

type Pain = {
  screen: string;
  information: boolean;
  hours: number;
  painPerHour: number | null;
  weighted: number;
  views: number;
  crashes: number;
  problems: number;
  errorMessages: number;
  failedCalls: number;
  slowCalls: number;
};

type Device = {
  device: string;
  devices: number;
  lastSeen: string | null;
  appVersion: string | null;
  crashes: number;
  offlineMinutes: number;
  offlineTimes: number;
  failedCalls: number;
  slowCalls: number;
};

type Truths = {
  range: { from: string; to: string; weeks: number };
  enoughData: boolean;
  daysOfData: number;
  daysNeeded: number;
  pain: Pain[] | null;
  messages: Array<{ title: string; count: number; errors: number; screens: number; topScreen: string }> | null;
  roles: Array<{ role: string; activeHours: number; openHours: number; views: number }> | null;
  funnel: Array<{ role: string; steps: Record<string, number> }> | null;
  creditNotices?: Array<{ role: string; shown: number; paid: number }> | null;
  slowCalls: Array<{ call: string; slow: number; failed: number; avgMs: number; topScreen: string }> | null;
  devices: Device[];
  problemsOpen: number;
};

const WEEKS = [
  { value: "1", label: "Last 7 days" },
  { value: "2", label: "Last 2 weeks" },
  { value: "4", label: "Last 4 weeks" },
  { value: "12", label: "Last 12 weeks" },
  { value: "52", label: "Last year" },
];

const roleLabel = (role: string) => role.toLowerCase().replace(/_/g, " ");
const h = (n: number) => n.toFixed(1);

function Section({ title, hint, children, testId }: { title: string; hint?: string; children: ReactNode; testId?: string }) {
  return (
    <Card className={LM_CARD} data-testid={testId}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent className="overflow-x-auto">{children}</CardContent>
    </Card>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function PainTable({ rows }: { rows: Pain[] }) {
  if (rows.length === 0) return <Empty>No screens used in this window.</Empty>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Screen</TableHead>
          <TableHead className="text-right">Pain per hour</TableHead>
          <TableHead className="text-right">Hours</TableHead>
          <TableHead className="text-right">Crashes</TableHead>
          <TableHead className="text-right">Problem?</TableHead>
          <TableHead className="text-right">Error messages</TableHead>
          <TableHead className="text-right">Failed calls</TableHead>
          <TableHead className="text-right">Slow calls</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.screen} data-testid={`friction-pain-${r.screen}`}>
            <TableCell className="break-all">
              {r.screen}
              {r.information && (
                <Badge variant="outline" className="ml-2">
                  {INFORMATION_SCREEN_LABEL}
                </Badge>
              )}
            </TableCell>
            <TableCell className="text-right font-medium">{r.painPerHour === null ? "too little use" : r.painPerHour.toFixed(1)}</TableCell>
            <TableCell className="text-right">
              {h(r.hours)} {r.information ? "open" : "active"}
            </TableCell>
            <TableCell className="text-right">{r.crashes}</TableCell>
            <TableCell className="text-right">{r.problems}</TableCell>
            <TableCell className="text-right">{r.errorMessages}</TableCell>
            <TableCell className="text-right">{r.failedCalls}</TableCell>
            <TableCell className="text-right">{r.slowCalls}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StudyWindowCard() {
  const { toast } = useToast();
  const { data } = useQuery<StudyWindow & { active: boolean; recorderConnected: boolean }>({ queryKey: ["/api/usage/study-window"] });
  const [draft, setDraft] = useState<StudyWindow | null>(null);
  const w = draft ?? data ?? { enabled: false, screens: [], endsOn: null };
  const today = localIsoDate();
  const save = useMutation({
    mutationFn: async (body: StudyWindow) => (await apiRequest("PUT", "/api/usage/study-window", body)).json(),
    onSuccess: () => {
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ["/api/usage/study-window"] });
      toast({ title: "Study setting saved" });
    },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  return (
    <Section
      title="Improvement study (screen recordings)"
      hint="Off unless you turn it on. No recorder is connected yet: turning this on only shows staff the notice on the chosen screens. A recorder is added only after Friction Truths names a problem screen and an adviser has reviewed it."
      testId="friction-study"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            id="study-enabled"
            checked={w.enabled}
            onCheckedChange={(v) => setDraft({ ...w, enabled: v, endsOn: w.endsOn ?? shiftIsoDate(today, STUDY_MAX_DAYS) })}
            data-testid="switch-study-enabled"
          />
          <Label htmlFor="study-enabled">Announce a study window</Label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="study-screens" className="text-xs">
              Screens (up to {STUDY_MAX_SCREENS}, one per line, as shown in the pain table)
            </Label>
            <textarea
              id="study-screens"
              className="min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={w.screens.join("\n")}
              onChange={(e) => setDraft({ ...w, screens: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
              data-testid="input-study-screens"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="study-ends" className="text-xs">
              Ends on (at most {STUDY_MAX_DAYS} days away)
            </Label>
            <Input
              id="study-ends"
              type="date"
              min={today}
              max={shiftIsoDate(today, STUDY_MAX_DAYS)}
              value={w.endsOn ?? ""}
              onChange={(e) => setDraft({ ...w, endsOn: e.target.value || null })}
              className="min-h-[44px] w-[180px]"
              data-testid="input-study-ends"
            />
          </div>
        </div>
        <Button
          size="sm"
          className="min-h-[44px]"
          disabled={!draft || save.isPending}
          onClick={() => save.mutate({ ...w, screens: w.screens.slice(0, STUDY_MAX_SCREENS) })}
          data-testid="button-study-save"
        >
          Save
        </Button>
      </div>
    </Section>
  );
}

export default function FrictionTruthsPage() {
  const [weeks, setWeeks] = useState("4");
  const { data, isLoading, isError } = useQuery<Truths>({
    queryKey: ["/api/friction-truths", weeks],
    queryFn: () => getJson(`/api/friction-truths?weeks=${weeks}`),
  });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        icon={Gauge}
        title="Friction Truths"
        question="Where do staff get stuck?"
        explanation="From arcarna's own usage record: screens, active time, messages, slow and failed calls, crashes and time offline. By screen, role and device, never by person, and not for staff reviews. Only you can see it."
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Window</Label>
          <Select value={weeks} onValueChange={setWeeks}>
            <SelectTrigger className="min-h-[44px] w-[180px]" data-testid="select-friction-window">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKS.map((w) => (
                <SelectItem key={w.value} value={w.value}>
                  {w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button asChild variant="outline" className="min-h-[44px]" data-testid="link-friction-problems">
          <Link href="/problems">
            <LifeBuoy className="mr-2 h-4 w-4" aria-hidden />
            Problem? inbox{data ? ` (${data.problemsOpen} open)` : ""}
          </Link>
        </Button>
      </div>

      {isError && <p className="text-sm text-destructive">Could not load Friction Truths. Try again.</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {data && !data.enoughData && (
        <Card className={LM_CARD} data-testid="friction-not-enough">
          <CardContent className="space-y-1 pt-6">
            <p className="font-medium">Not enough data yet</p>
            <p className="text-sm text-muted-foreground">
              {data.daysOfData} of {data.daysNeeded} days recorded. The rankings appear after two weeks, when a few bad minutes can no
              longer make a screen look worse than it is. Device health and the Problem? inbox work from day one. The Monday top five
              starts after three weeks.
            </p>
          </CardContent>
        </Card>
      )}

      {data?.pain && (
        <Section
          title="Pain per active hour"
          hint={`Crashes count 5, Problem? reports 3, error messages and failed calls 2, slow calls (over ${SLOW_CALL_MS / 1000} s) 1, over the hours the screen was in use (input in the last 30 s, tab visible). The board is scored per open hour as an ${INFORMATION_SCREEN_LABEL}.`}
          testId="friction-pain"
        >
          <PainTable rows={data.pain} />
        </Section>
      )}

      {data?.messages && (
        <Section title="Messages staff see" hint="By title only; names and numbers are cut out before they are stored." testId="friction-messages">
          {data.messages.length === 0 ? (
            <Empty>No messages in this window.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-right">Seen</TableHead>
                  <TableHead className="text-right">As an error</TableHead>
                  <TableHead className="text-right">Screens</TableHead>
                  <TableHead>Mostly on</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.messages.map((m) => (
                  <TableRow key={m.title}>
                    <TableCell>{m.title}</TableCell>
                    <TableCell className="text-right">{m.count}</TableCell>
                    <TableCell className="text-right">{m.errors}</TableCell>
                    <TableCell className="text-right">{m.screens}</TableCell>
                    <TableCell className="break-all">{m.topScreen}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      )}

      {data?.roles && (
        <Section title="Active time by role" testId="friction-roles">
          {data.roles.length === 0 ? (
            <Empty>No screen time in this window.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Active hours</TableHead>
                  <TableHead className="text-right">Open hours</TableHead>
                  <TableHead className="text-right">Screens opened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.roles.map((r) => (
                  <TableRow key={r.role}>
                    <TableCell className="capitalize">{roleLabel(r.role)}</TableCell>
                    <TableCell className="text-right">{h(r.activeHours)}</TableCell>
                    <TableCell className="text-right">{h(r.openHours)}</TableCell>
                    <TableCell className="text-right">{r.views}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      )}

      {data?.funnel && (
        <Section title="Sale funnel by role" hint="How many sales reached each step, and how many started ended placed." testId="friction-funnel">
          {data.funnel.length === 0 ? (
            <Empty>No sales in this window.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  {FUNNEL_STEPS.map((s) => (
                    <TableHead key={s.key} className="text-right">
                      {s.label}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Started to placed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.funnel.map((f) => (
                  <TableRow key={f.role}>
                    <TableCell className="capitalize">{roleLabel(f.role)}</TableCell>
                    {FUNNEL_STEPS.map((s) => (
                      <TableCell key={s.key} className="text-right">
                        {f.steps[s.key] ?? 0}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      {f.steps.start ? `${Math.round(((f.steps.done ?? 0) / f.steps.start) * 100)}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      )}

      {data?.creditNotices && data.creditNotices.length > 0 && (
        <Section
          title="Already owes, at order start"
          hint="How often the till told staff a customer already owed on credit, and how often a payment was taken from it."
          testId="friction-credit-notices"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Shown</TableHead>
                <TableHead className="text-right">Payment taken</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.creditNotices.map((c) => (
                <TableRow key={c.role}>
                  <TableCell className="capitalize">{roleLabel(c.role)}</TableCell>
                  <TableCell className="text-right">{c.shown}</TableCell>
                  <TableCell className="text-right">{c.paid}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {data?.slowCalls && (
        <Section title="Slow and failed calls" hint={`Calls slower than ${SLOW_CALL_MS / 1000} s, or that failed, including the sale itself.`} testId="friction-calls">
          {data.slowCalls.length === 0 ? (
            <Empty>No slow or failed calls in this window.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Call</TableHead>
                  <TableHead className="text-right">Slow</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Average time</TableHead>
                  <TableHead>Mostly on</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.slowCalls.map((c) => (
                  <TableRow key={c.call}>
                    <TableCell className="break-all font-mono text-xs">{c.call}</TableCell>
                    <TableCell className="text-right">{c.slow}</TableCell>
                    <TableCell className="text-right">{c.failed}</TableCell>
                    <TableCell className="text-right">{(c.avgMs / 1000).toFixed(1)} s</TableCell>
                    <TableCell className="break-all">{c.topScreen}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      )}

      {data && (
        <Section title="Device health" hint="The last 7 days, by the device's name (Settings > System, or the Problem? sheet)." testId="friction-devices">
          {data.devices.length === 0 ? (
            <Empty>No device has sent anything yet.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead className="text-right">Crashes</TableHead>
                  <TableHead className="text-right">Offline</TableHead>
                  <TableHead className="text-right">Failed calls</TableHead>
                  <TableHead className="text-right">Slow calls</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.devices.map((d) => (
                  <TableRow key={d.device} data-testid={`friction-device-${d.device}`}>
                    <TableCell>
                      {d.device}
                      {d.devices > 1 && (
                        <span className="block text-xs text-muted-foreground">{d.devices} browsers use this name</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {d.lastSeen ? new Date(d.lastSeen).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—"}
                    </TableCell>
                    <TableCell>{d.appVersion ?? "—"}</TableCell>
                    <TableCell className="text-right">{d.crashes}</TableCell>
                    <TableCell className="text-right">
                      {d.offlineTimes ? `${d.offlineTimes}× · ${d.offlineMinutes} min` : "—"}
                    </TableCell>
                    <TableCell className="text-right">{d.failedCalls}</TableCell>
                    <TableCell className="text-right">{d.slowCalls}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      )}

      <StudyWindowCard />
    </div>
  );
}
