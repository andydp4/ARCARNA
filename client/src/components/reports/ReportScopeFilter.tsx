/**
 * ARC-026: location/staff filter controls shared by every report that can
 * sensibly be scoped this way (Daily Sales, Weekly Sales, Current Stock,
 * Weekly Margin). Locations come from `/api/locations`, the list other
 * pickers already use.
 *
 * Staff come from `/api/evidence/staff` and are keyed by the person, not a
 * cashier code (STF-FN2): the Evidence counts whoever completed each order.
 * No shift has carried a code since the lazy-shift change, so the old
 * code-keyed picker answered £0 for everyone trading today.
 *
 * "All locations" / "All staff" is the default (no filter applied) — an
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

interface StaffOption {
  id: string;
  name: string;
}

const ALL = "__all__";

export interface ReportScopeValue {
  locationId?: string;
  /** A person's user id (who completed the order). */
  staffId?: string;
}

export function ReportScopeFilter({
  value,
  onChange,
  showCashier = true,
}: {
  value: ReportScopeValue;
  onChange: (next: ReportScopeValue) => void;
  /** Some reports (e.g. Current Stock) have no staff dimension — omit the picker there. */
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

  const { data: staff = [] } = useQuery<StaffOption[]>({
    queryKey: ["/api/evidence/staff"],
    queryFn: async () => {
      const res = await apiFetch("/api/evidence/staff", { credentials: "include" });
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
          value={value.staffId ?? ALL}
          onValueChange={(v) => onChange({ ...value, staffId: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="h-9 w-[160px]" data-testid="select-report-staff">
            <SelectValue placeholder="All staff" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All staff</SelectItem>
            {staff.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/**
 * Shown under a report filtered to one person. Orders from before 27 August
 * 2026 were attributed by migration 057 from whoever opened the shift, so
 * those weeks are an inference, not a record — the owner should know which
 * figures are which.
 */
export function StaffFilterFootnote({ value }: { value: ReportScopeValue }) {
  if (!value.staffId) return null;
  return (
    <p className="mt-3 text-xs text-muted-foreground" data-testid="text-staff-filter-footnote">
      Filtered to the person who completed each order. Before 27 August 2026, who completed an order is inferred from
      who opened the shift.
    </p>
  );
}
