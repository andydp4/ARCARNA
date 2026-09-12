import { forwardRef, type ReactNode } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The board's toolbar: what am I looking at, and how do I narrow it.
 *
 * Three filters and a search, because on a busy counter the board is either
 * "everything, so I can see the shop" or "just the ones I am carrying". The
 * filter set is the brief's (`mine` | `unassigned` | `all`) even though
 * assignment itself does not exist until N3b — landing the control now means
 * the operator's choice, which is remembered per device, survives the upgrade
 * instead of being reset by it.
 *
 * The summary counts are the same figures the Control Centre shows, derived
 * from the same cards on the screen, so the board can never disagree with
 * itself the way the old list and its five stat tiles could.
 */

export type OpsFilter = "mine" | "unassigned" | "all";

export interface OpsHeaderProps {
  filter: OpsFilter;
  onFilterChange: (filter: OpsFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  summary: { open: number; lateNow: number; dueSoonNow: number; completedToday: number };
  isFetching: boolean;
  onRefresh: () => void;
  /** N6 hangs the shift controls here; N5b the audio toggle and alert count. */
  extras?: ReactNode;
  /** N4a: `OpsStaffStrip` (who is on) and `OpsStationPicker` (your station, your break). Its own row — filters answer "what am I looking at", this answers "who am I, on this board". */
  stationRow?: ReactNode;
}

const FILTERS: Array<{ value: OpsFilter; label: string; hint: string }> = [
  { value: "mine", label: "Mine", hint: "Orders you are looking after" },
  { value: "unassigned", label: "Unassigned", hint: "Nobody has taken these yet" },
  { value: "all", label: "All", hint: "Everything on the board" },
];

export const OpsHeader = forwardRef<HTMLInputElement, OpsHeaderProps>(function OpsHeader(
  { filter, onFilterChange, search, onSearchChange, summary, isFetching, onRefresh, extras, stationRow },
  searchRef,
) {
  return (
    <div className="flex flex-col gap-3">
      {stationRow}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[min(100%,16rem)] flex-1 space-y-1">
          <Label htmlFor="ops-order-search" className="text-xs text-muted-foreground">
            Search this board
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="ops-order-search"
              ref={searchRef}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Order number, customer, or payment…"
              className="min-h-11 pl-9"
              data-testid="input-order-search"
            />
          </div>
        </div>

        <div
          role="group"
          aria-label="Which orders to show"
          className="flex flex-wrap items-center gap-2"
        >
          {FILTERS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="touch"
              variant={filter === option.value ? "default" : "outline"}
              aria-pressed={filter === option.value}
              title={option.hint}
              onClick={() => onFilterChange(option.value)}
              data-testid={`ops-filter-${option.value}`}
            >
              {option.label}
            </Button>
          ))}
          <Button
            type="button"
            size="touch"
            variant="outline"
            onClick={onRefresh}
            aria-label="Refresh the board now"
            data-testid="ops-refresh"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden />
          </Button>
          {extras}
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span data-testid="ops-summary-open">
          <span className="font-semibold tabular-nums text-foreground">{summary.open}</span> open
        </span>
        <span data-testid="ops-summary-late">
          <span className="font-semibold tabular-nums text-foreground">{summary.lateNow}</span> late
          now
        </span>
        <span data-testid="ops-summary-due-soon">
          <span className="font-semibold tabular-nums text-foreground">{summary.dueSoonNow}</span>{" "}
          due soon
        </span>
        <span data-testid="ops-summary-completed">
          <span className="font-semibold tabular-nums text-foreground">
            {summary.completedToday}
          </span>{" "}
          done today
        </span>
      </p>
    </div>
  );
});
