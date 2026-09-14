/**
 * ARC-026: location/cashier filter controls shared by every report that can
 * sensibly be scoped this way (Daily Sales, Weekly Sales, Current Stock,
 * Weekly Margin). Fetches the same `/api/locations` and `/api/cashiers`
 * lists other pickers in the app already use (see
 * client/src/components/inventory/TransfersTab.tsx for the location list,
 * `/api/cashiers` for the cashier list) rather than inventing a new source.
 *
 * "All locations" / "All cashiers" is the default (no filter applied) — an
 * explicit choice, not a silent fallback to the caller's own current
 * location, since a report should default to the whole picture unless asked
 * to narrow it.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface LocationOption {
  id: string;
  name: string;
}

interface CashierOption {
  id: string;
  displayName: string;
}

const ALL = "__all__";

export interface ReportScopeValue {
  locationId?: string;
  cashierId?: string;
}

export function ReportScopeFilter({
  value,
  onChange,
  showCashier = true,
}: {
  value: ReportScopeValue;
  onChange: (next: ReportScopeValue) => void;
  /** Some reports (e.g. Current Stock) have no cashier dimension — omit the picker there. */
  showCashier?: boolean;
}) {
  const { data: locations = [] } = useQuery<LocationOption[]>({
    queryKey: ["/api/locations"],
    queryFn: async () => {
      const res = await apiFetch("/api/locations", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: cashiers = [] } = useQuery<CashierOption[]>({
    queryKey: ["/api/cashiers"],
    queryFn: async () => {
      const res = await apiFetch("/api/cashiers", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: showCashier,
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={value.locationId ?? ALL}
        onValueChange={(v) => onChange({ ...value, locationId: v === ALL ? undefined : v })}
      >
        <SelectTrigger className="h-9 w-[160px]" data-testid="select-report-location">
          <SelectValue placeholder="All locations" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All locations</SelectItem>
          {locations.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showCashier && (
        <Select
          value={value.cashierId ?? ALL}
          onValueChange={(v) => onChange({ ...value, cashierId: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="h-9 w-[160px]" data-testid="select-report-cashier">
            <SelectValue placeholder="All cashiers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All cashiers</SelectItem>
            {cashiers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
