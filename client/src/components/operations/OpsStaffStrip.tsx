import { cn } from "@/lib/utils";
import type { OpsBoardStaffRow } from "@/hooks/useOpsBoard";

/**
 * "Who is on" — the brief's `ops-staff-strip`: initials, a station dot, "seen
 * 3m", greyed when absent or on break.
 *
 * Reads `useOpsBoard`'s own `staff` array rather than calling
 * `GET /api/operations/staff` a second time: the board already computes this
 * exact list — `allowed_users` of the org minus CUSTOMER, joined to
 * `ops_staff`, "present" from `last_seen_at` within 15 minutes
 * (`server/services/opsBoard.ts`, N3a) — and the stream already pushes
 * `{ type: 'staff' }` deltas straight into the same query-cache entry
 * (`applyOpsBusEvent`). A second fetch of the identical computation would be
 * the one thing the brief calls out by name: "zero database reads while
 * nothing changes."
 */
export interface OpsStaffStripProps {
  staff: OpsBoardStaffRow[];
  now: Date;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function seenLabel(lastSeenAt: string | null, now: Date): string {
  if (!lastSeenAt) return "not seen yet";
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(lastSeenAt).getTime()) / 60_000));
  if (minutes < 1) return "seen just now";
  return `seen ${minutes}m`;
}

function stationDotClass(station: string | null): string {
  switch (station) {
    case "collection":
      return "bg-ops-ontime";
    case "delivery":
      return "bg-ops-ready";
    case "both":
      return "bg-ops-completed";
    default:
      return "bg-muted-foreground";
  }
}

export function OpsStaffStrip({ staff, now }: OpsStaffStripProps) {
  if (staff.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Who is on"
      className="flex flex-wrap items-center gap-2"
      data-testid="ops-staff-strip"
    >
      {staff.map((member) => {
        const away = !member.present || member.onBreak;
        return (
          <span
            key={member.userId}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 text-xs font-medium",
              away ? "text-muted-foreground" : "text-foreground",
            )}
            title={`${member.name} · ${member.station ?? "no station set"} · ${seenLabel(member.lastSeenAt, now)}${member.onBreak ? " · on break" : ""}`}
            data-testid={`ops-staff-${member.userId}`}
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full", stationDotClass(member.station))} aria-hidden />
            {initials(member.name)}
            {member.onBreak && <span aria-hidden> · break</span>}
            {member.onBreak && <span className="sr-only"> on break</span>}
          </span>
        );
      })}
    </div>
  );
}
