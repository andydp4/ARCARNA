import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
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

const SHIFT_STORAGE_KEY = "midnight_currentShiftId";

export function getStoredShiftId(): string | null {
  try {
    return localStorage.getItem(SHIFT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredShiftId(id: string | null) {
  try {
    if (id) localStorage.setItem(SHIFT_STORAGE_KEY, id);
    else localStorage.removeItem(SHIFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

interface Location {
  id: string;
  name: string;
}

interface ShiftOpenModalProps {
  open: boolean;
  onShiftOpened: (shiftId: string) => void;
}

export function ShiftOpenModal({ open, onShiftOpened }: ShiftOpenModalProps) {
  const { toast } = useToast();
  const [openingFloat, setOpeningFloat] = useState("50");
  const [locationId, setLocationId] = useState("");

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: open,
  });

  const openMutation = useMutation({
    mutationFn: async () => {
      const loc = locationId || locations[0]?.id;
      if (!loc) throw new Error("Select a location");
      const res = await apiRequest("POST", "/api/shifts/open", {
        locationId: loc,
        openingFloat: parseFloat(openingFloat) || 0,
      });
      return res.json();
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

  const effectiveLocation =
    locationId || (locations.length === 1 ? locations[0].id : "");

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
            <Label>Location</Label>
            <Select
              value={effectiveLocation}
              onValueChange={setLocationId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
            disabled={!effectiveLocation || openMutation.isPending}
            onClick={() => openMutation.mutate()}
          >
            Open shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
