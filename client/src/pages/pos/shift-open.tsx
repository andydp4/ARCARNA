import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, getJson, queryClient } from "@/lib/queryClient";
import {
  setActiveCashierId,
  setActiveCashierShiftId,
  setActiveCashierShiftReplayToken,
  getActiveCashierId,
} from "@/lib/orgScope";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  migrateStorageKey,
  STORAGE_SHIFT_ID,
  STORAGE_SHIFT_ID_LEGACY,
} from "@shared/storageKeys";

export function getStoredShiftId(): string | null {
  try {
    return migrateStorageKey(STORAGE_SHIFT_ID_LEGACY, STORAGE_SHIFT_ID);
  } catch {
    return null;
  }
}

export function setStoredShiftId(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_SHIFT_ID, id);
    else localStorage.removeItem(STORAGE_SHIFT_ID);
  } catch {
    /* ignore */
  }
}

/** Fired after this modal starts a cashier shift so CashierShiftBadge re-reads it. */
export const CASHIER_SHIFT_CHANGED_EVENT = "arcarna:cashier-shift-changed";

interface Location {
  id: string;
  name: string;
  isDefault?: number;
  isActive?: number;
}

interface CashierProfile {
  id: string;
  cashierCode: string;
  displayName: string;
}

interface CashierShift {
  id: string;
  cashierId: string;
  replayToken?: string;
}

interface ShiftOpenModalProps {
  open: boolean;
  onShiftOpened: (shiftId: string) => void;
}

/** Turns the `"<status>: <body>"` error the query client throws into readable copy. */
function describeLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.startsWith("403")) {
    return "Your account does not have permission to load this list. Ask an admin to check your role.";
  }
  if (message.startsWith("401")) {
    return "Your session has expired. Sign in again to continue.";
  }
  if (/Failed to fetch|NetworkError/i.test(message)) {
    return "Could not reach the server. Check your connection and try again.";
  }
  return message || "Something went wrong loading this list.";
}

export function ShiftOpenModal({ open, onShiftOpened }: ShiftOpenModalProps) {
  const { toast } = useToast();
  const [openingFloat, setOpeningFloat] = useState("50");
  const [locationId, setLocationId] = useState("");
  const [cashierId, setCashierId] = useState("");

  const { data: settings } = useQuery<{
    cashierCommissionEnabled?: boolean;
    requireCashierForSale?: boolean;
  }>({
    queryKey: ["/api/settings"],
  });

  const cashierCodesEnabled = !!settings?.cashierCommissionEnabled;
  const cashierRequired = cashierCodesEnabled && !!settings?.requireCashierForSale;

  const {
    data: locations = [],
    isLoading: locationsLoading,
    isError: locationsFailed,
    error: locationsError,
    refetch: refetchLocations,
  } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: open,
  });

  const {
    data: cashiers = [],
    isLoading: cashiersLoading,
    isError: cashiersFailed,
    error: cashiersError,
    refetch: refetchCashiers,
  } = useQuery<CashierProfile[]>({
    queryKey: ["/api/cashiers"],
    queryFn: () => getJson<CashierProfile[]>("/api/cashiers"),
    enabled: open && cashierCodesEnabled,
  });

  // Preselect the org's default location (the list is already sorted with it
  // first), so a multi-location org is not left staring at an empty picker.
  useEffect(() => {
    if (locationId || locations.length === 0) return;
    const preferred = locations.find((l) => l.isDefault) ?? (locations.length === 1 ? locations[0] : null);
    if (preferred) setLocationId(preferred.id);
  }, [locations, locationId]);

  // Re-select the cashier code this device last used, when it is still active.
  useEffect(() => {
    if (cashierId || cashiers.length === 0) return;
    const stored = getActiveCashierId();
    const preferred =
      (stored && cashiers.find((c) => c.id === stored)) ?? (cashiers.length === 1 ? cashiers[0] : null);
    if (preferred) setCashierId(preferred.id);
  }, [cashiers, cashierId]);

  /** Starts the cashier shift, adopting one that is already open for that code. */
  async function startCashierShift(id: string): Promise<CashierShift> {
    try {
      const res = await apiRequest("POST", "/api/cashier-shifts/start", { cashierId: id });
      return (await res.json()) as CashierShift;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.startsWith("409")) throw error;
      // This code already has an open shift (another device, or a reload) —
      // reuse it rather than blocking the till shift behind a duplicate.
      const current = await getJson<{ shift: CashierShift | null }>(`/api/cashier-shifts/current/${id}`);
      if (!current.shift) throw error;
      return current.shift;
    }
  }

  const openMutation = useMutation({
    mutationFn: async () => {
      if (!locationId) throw new Error("Select a location");
      if (cashierRequired && !cashierId) throw new Error("Select your cashier code");

      const res = await apiRequest("POST", "/api/shifts/open", {
        locationId,
        openingFloat: parseFloat(openingFloat) || 0,
      });
      const shift = (await res.json()) as { id: string };

      if (cashierCodesEnabled && cashierId) {
        // The till shift is already open on the server; a failure here must not
        // fail the mutation, or the retry hits "you already have an open shift".
        // Warn instead and let the cashier badge pick the code up separately.
        try {
          const cashierShift = await startCashierShift(cashierId);
          setActiveCashierId(cashierShift.cashierId);
          setActiveCashierShiftId(cashierShift.id);
          setActiveCashierShiftReplayToken(cashierShift.replayToken ?? null);
          queryClient.invalidateQueries({ queryKey: ["/api/cashier-shifts/current"] });
          window.dispatchEvent(new CustomEvent(CASHIER_SHIFT_CHANGED_EVENT));
        } catch (error) {
          toast({
            title: "Cashier shift not started",
            description: `${describeLoadError(error)} Your till shift is open — start the cashier shift from the badge.`,
            variant: "destructive",
          });
        }
      }

      return shift;
    },
    onSuccess: (shift: { id: string }) => {
      setStoredShiftId(shift.id);
      queryClient.invalidateQueries({ queryKey: ["/api/shifts/current"] });
      toast({ title: "Shift opened", description: "You can now take orders." });
      onShiftOpened(shift.id);
    },
    onError: (err: Error) => {
      toast({
        title: "Could not open shift",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const noLocations = !locationsLoading && !locationsFailed && locations.length === 0;
  const noCashiers = cashierCodesEnabled && !cashiersLoading && !cashiersFailed && cashiers.length === 0;
  const canSubmit = !!locationId && (!cashierRequired || !!cashierId);

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Open shift</DialogTitle>
          <DialogDescription>
            Enter your opening float before taking POS orders.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="shift-open-location">Location</Label>
            <Select value={locationId} onValueChange={setLocationId} disabled={locations.length === 0}>
              {/* Radix renders the trigger as a bare combobox button: without
                  this the control has no accessible name at all (axe
                  button-name, critical). */}
              <SelectTrigger id="shift-open-location" aria-label="Location">
                <SelectValue placeholder={locationsLoading ? "Loading locations…" : "Select location"} />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {locationsFailed && (
              <p className="text-sm text-destructive" data-testid="text-locations-error">
                {describeLoadError(locationsError)}{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => refetchLocations()}
                >
                  Retry
                </button>
              </p>
            )}
            {noLocations && (
              <p className="text-sm text-muted-foreground" data-testid="text-locations-empty">
                No locations set up yet. An admin needs to add one in Settings → Locations.
              </p>
            )}
          </div>

          {cashierCodesEnabled && (
            <div className="space-y-2">
              <Label htmlFor="shift-open-cashier">
                Cashier code{!cashierRequired && <span className="text-muted-foreground"> (optional)</span>}
              </Label>
              <Select value={cashierId} onValueChange={setCashierId} disabled={cashiers.length === 0}>
                <SelectTrigger id="shift-open-cashier" aria-label="Cashier code" data-testid="select-shift-cashier-code">
                  <SelectValue placeholder={cashiersLoading ? "Loading cashier codes…" : "Select cashier code"} />
                </SelectTrigger>
                <SelectContent>
                  {cashiers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.cashierCode} — {c.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cashiersFailed && (
                <p className="text-sm text-destructive" data-testid="text-cashiers-error">
                  {describeLoadError(cashiersError)}{" "}
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() => refetchCashiers()}
                  >
                    Retry
                  </button>
                </p>
              )}
              {noCashiers && (
                <p className="text-sm text-muted-foreground" data-testid="text-cashiers-empty">
                  No cashier codes yet. Add them in Settings → Cashiers.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="opening-float">Opening float (£)</Label>
            <Input
              id="opening-float"
              type="number"
              min={0}
              step="0.01"
              value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            className="w-full"
            disabled={!canSubmit || openMutation.isPending}
            onClick={() => openMutation.mutate()}
          >
            Open shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
