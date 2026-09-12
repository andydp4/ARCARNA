/**
 * The Operations Centre's timing policy.
 *
 * These eight numbers decide what every card on the board looks like: when it
 * turns DUE SOON, when it is called late, what a card with no promised time
 * counts against, and whether a new order gets an owner on its own. They are
 * org settings rather than constants because "20 minutes" means something
 * different in a butcher's to a bakery — see
 * docs/briefs/PHASE_N_OPERATIONS_CENTRE.md § "Decisions locked".
 *
 * Saved to the account (PATCH /api/org/setup, MANAGER+), not to this browser:
 * a grace period one tablet disagrees about is worse than no grace at all.
 * Cashiers read the same values back from GET /api/settings, which is the
 * board's source for them.
 *
 * Mirrors CashierCommissionSettings: useQuery + useMutation + apiRequest PATCH
 * + toast + invalidate, each field saving on change or on blur so there is no
 * Save button to forget.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { OrgSetup } from "@shared/setup";

/** Field key, label, help text and the bounds `orgProfilePatchSchema` enforces. */
const MINUTE_FIELDS = [
  {
    key: "opsPrepSlaMinutes",
    label: "Collection prep time",
    help: "How long a collection order should take when nobody promised a time. Used for colour only — an order with no promise never counts down and never alerts.",
    min: 1,
    max: 480,
    fallback: 20,
  },
  {
    key: "opsDeliveryLeadMinutes",
    label: "Delivery lead time",
    help: "The same fallback for deliveries, and the time a web delivery is promised when the site does not ask for one.",
    min: 1,
    max: 480,
    fallback: 45,
  },
  {
    key: "opsDueSoonLeadMinutes",
    label: "Due soon warning",
    help: "How long before the promised time a card turns DUE SOON and its owner is alerted.",
    min: 0,
    max: 120,
    fallback: 10,
  },
  {
    key: "opsLateGraceMinutes",
    label: "Late grace period",
    help: "How far past the promised time an order may run before the card goes red.",
    min: 0,
    max: 120,
    fallback: 5,
  },
] as const;

type MinuteKey = (typeof MINUTE_FIELDS)[number]["key"];

export function OperationsSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: org, isLoading } = useQuery<OrgSetup>({
    queryKey: ["/api/org/setup"],
  });

  const [minutes, setMinutes] = useState<Record<MinuteKey, string>>({
    opsPrepSlaMinutes: "20",
    opsDeliveryLeadMinutes: "45",
    opsDueSoonLeadMinutes: "10",
    opsLateGraceMinutes: "5",
  });
  const [autoClaim, setAutoClaim] = useState(true);
  const [alertOnSlaDue, setAlertOnSlaDue] = useState(false);
  const [keepAwake, setKeepAwake] = useState(true);
  const [pollSeconds, setPollSeconds] = useState("60");

  useEffect(() => {
    if (!org) return;
    setMinutes({
      opsPrepSlaMinutes: String(org.opsPrepSlaMinutes ?? 20),
      opsDeliveryLeadMinutes: String(org.opsDeliveryLeadMinutes ?? 45),
      opsDueSoonLeadMinutes: String(org.opsDueSoonLeadMinutes ?? 10),
      opsLateGraceMinutes: String(org.opsLateGraceMinutes ?? 5),
    });
    setAutoClaim(org.opsAutoClaimOnCreate ?? true);
    setAlertOnSlaDue(org.opsAlertOnSlaDue ?? false);
    setKeepAwake(org.opsKeepScreenAwake ?? true);
    setPollSeconds(String(org.opsReconcilePollSeconds ?? 60));
  }, [org]);

  const saveSettings = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      await apiRequest("PATCH", "/api/org/setup", patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/setup"] });
      // The board reads these back from /api/settings, which cashiers can see.
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Operations settings updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  /** Out-of-range or non-numeric entries snap back to the saved value rather than saving nonsense. */
  const commitMinutes = (field: (typeof MINUTE_FIELDS)[number]) => {
    const entered = Number(minutes[field.key]);
    const saved = (org?.[field.key] as number | null | undefined) ?? field.fallback;
    if (!Number.isInteger(entered) || entered < field.min || entered > field.max) {
      setMinutes((prev) => ({ ...prev, [field.key]: String(saved) }));
      return;
    }
    if (entered === saved) return;
    saveSettings.mutate({ [field.key]: entered });
  };

  return (
    <Card className="border-0 shadow-none lm-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5" /> Operations board
        </CardTitle>
        <CardDescription>
          Timing for the Operations Centre: what counts as on time, when a card warns, and who
          picks up a new order. Saved to your account and used on every tablet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {MINUTE_FIELDS.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key}>{field.label}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={field.key}
                      type="number"
                      inputMode="numeric"
                      min={field.min}
                      max={field.max}
                      step="1"
                      className="min-h-[44px]"
                      data-testid={`settings-${field.key}`}
                      value={minutes[field.key]}
                      onChange={(e) =>
                        setMinutes((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      onBlur={() => commitMinutes(field)}
                    />
                    <span className="text-sm text-muted-foreground">min</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{field.help}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="pr-4">
                <p className="text-sm font-medium">Give new orders an owner automatically</p>
                <p className="text-xs text-muted-foreground">
                  The person who keyed it in, if they are on that station; otherwise the least busy
                  cashier on it. Anyone can pass it on or release it afterwards.
                </p>
              </div>
              <Switch
                checked={autoClaim}
                onCheckedChange={(v) => {
                  setAutoClaim(v);
                  saveSettings.mutate({ opsAutoClaimOnCreate: v });
                }}
                data-testid="settings-ops-auto-claim"
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="pr-4">
                <p className="text-sm font-medium">Alert on orders with no promised time</p>
                <p className="text-xs text-muted-foreground">
                  Off by default: an order nobody promised a time for is still coloured against the
                  prep time above, but nobody is chased about a promise the shop never made.
                </p>
              </div>
              <Switch
                checked={alertOnSlaDue}
                onCheckedChange={(v) => {
                  setAlertOnSlaDue(v);
                  saveSettings.mutate({ opsAlertOnSlaDue: v });
                }}
                data-testid="settings-ops-alert-sla"
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="pr-4">
                <p className="text-sm font-medium">Keep the screen awake on the board</p>
                <p className="text-xs text-muted-foreground">
                  Stops the tablet dimming while the Operations Centre is open.
                </p>
              </div>
              <Switch
                checked={keepAwake}
                onCheckedChange={(v) => {
                  setKeepAwake(v);
                  saveSettings.mutate({ opsKeepScreenAwake: v });
                }}
                data-testid="settings-ops-keep-awake"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="opsReconcilePollSeconds">Board refresh check</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="opsReconcilePollSeconds"
                  type="number"
                  inputMode="numeric"
                  min={15}
                  max={600}
                  step="5"
                  className="min-h-[44px] sm:w-48"
                  data-testid="settings-ops-reconcile-poll"
                  value={pollSeconds}
                  onChange={(e) => setPollSeconds(e.target.value)}
                  onBlur={() => {
                    const entered = Number(pollSeconds);
                    const saved = org?.opsReconcilePollSeconds ?? 60;
                    if (!Number.isInteger(entered) || entered < 15 || entered > 600) {
                      setPollSeconds(String(saved));
                      return;
                    }
                    if (entered === saved) return;
                    saveSettings.mutate({ opsReconcilePollSeconds: entered });
                  }}
                />
                <span className="text-sm text-muted-foreground">seconds</span>
              </div>
              <p className="text-xs text-muted-foreground">
                The board is fed live by the server; this is only how often a tablet double-checks
                it has not missed anything. Lower means more database work for no extra speed.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
