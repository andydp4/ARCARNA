import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Coffee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { OPS_STATIONS, type OpsStation } from "@shared/schema";
import { STORAGE_OPS_STATION } from "@shared/storageKeys";

/**
 * "Pick your station" — the header picker (`ops-station-picker`, brief
 * "Assignment, stations & presence"): Collection / Delivery / Both / None,
 * sticky per person (`ops_staff.station`, N2/N3b), mirrored to
 * `STORAGE_OPS_STATION` for the instant local filter the brief asks for
 * ("mirrored … for an instant filter") while the write round-trips.
 *
 * The break toggle lives here too: it keeps the station but the brief is
 * explicit that it "removes the person from recipients and suggestions" —
 * nothing this package can act on yet (N5a's alerts and this package's own
 * `OpsPassMenu` sort do that once `ops_staff.on_break` is on the board's
 * `staff` rows, which it already is from N3b) — and offers "Hand over my
 * orders…" / "Release all". Those two loop `assign` / `unclaim` across every
 * order this person is carrying, which needs the board's own order list, so
 * the loop itself is `operations.tsx`'s (it already owns the transition
 * mutation and reads `board.orders`); this component only renders the two
 * buttons and reports which the operator pressed.
 */
export interface OpsStationPickerProps {
  me: { userId: string | null; station: string | null; onBreak: boolean };
  hasOpenAssigned: boolean;
  onHandOverMine: () => void;
  onReleaseAll: () => void;
  handOverPending?: boolean;
  releasePending?: boolean;
}

const STATION_LABEL: Record<OpsStation, string> = {
  collection: "Collection",
  delivery: "Delivery",
  both: "Both",
};

export function OpsStationPicker({
  me,
  hasOpenAssigned,
  onHandOverMine,
  onReleaseAll,
  handOverPending,
  releasePending,
}: OpsStationPickerProps) {
  const { toast } = useToast();
  const [station, setStation] = useState<string>(me.station ?? "none");
  const [onBreak, setOnBreak] = useState(me.onBreak);

  // The reconciliation poll (or another device) can change this from under
  // us — a manager setting someone's station from User Access, say — and a
  // picker that never re-reads its own prop would keep showing a choice the
  // server no longer holds.
  useEffect(() => {
    setStation(me.station ?? "none");
    setOnBreak(me.onBreak);
  }, [me.userId, me.station, me.onBreak]);

  const save = useMutation({
    mutationFn: async (body: { station?: OpsStation | null; onBreak?: boolean }) => {
      const response = await apiRequest("PATCH", "/api/operations/station", body);
      return response.json();
    },
    onError: (error: Error) => {
      toast({ title: "Could not update your station", description: error.message, variant: "destructive" });
    },
  });

  const writeStation = (next: string) => {
    const previous = { station, onBreak };
    setStation(next);
    const value: OpsStation | null = next === "none" ? null : (next as OpsStation);
    try {
      if (value) localStorage.setItem(STORAGE_OPS_STATION, value);
      else localStorage.removeItem(STORAGE_OPS_STATION);
    } catch {
      /* private mode — the write below still lands server-side */
    }
    save.mutate({ station: value }, { onError: () => setStation(previous.station) });
  };

  const writeBreak = (next: boolean) => {
    const previous = onBreak;
    setOnBreak(next);
    save.mutate({ onBreak: next }, { onError: () => setOnBreak(previous) });
  };

  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="ops-station-picker">
      <div className="space-y-1">
        <Label htmlFor="ops-station-select" className="text-xs text-muted-foreground">
          Your station
        </Label>
        <Select value={station} onValueChange={writeStation}>
          <SelectTrigger id="ops-station-select" className="min-h-11 w-40" data-testid="select-ops-station">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none" data-testid="ops-station-option-none">
              None
            </SelectItem>
            {OPS_STATIONS.map((option) => (
              <SelectItem key={option} value={option} data-testid={`ops-station-option-${option}`}>
                {STATION_LABEL[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        type="button"
        size="touch"
        variant={onBreak ? "default" : "outline"}
        aria-pressed={onBreak}
        onClick={() => writeBreak(!onBreak)}
        data-testid="ops-break-toggle"
      >
        <Coffee className="h-4 w-4" aria-hidden />
        {onBreak ? "On break" : "Take a break"}
      </Button>

      {onBreak && (
        <>
          <Button
            type="button"
            size="touch"
            variant="outline"
            disabled={!hasOpenAssigned || handOverPending}
            onClick={onHandOverMine}
            data-testid="ops-hand-over-mine"
          >
            Hand over my orders…
          </Button>
          <Button
            type="button"
            size="touch"
            variant="outline"
            disabled={!hasOpenAssigned || releasePending}
            onClick={onReleaseAll}
            data-testid="ops-release-all"
          >
            Release all
          </Button>
        </>
      )}
    </div>
  );
}
