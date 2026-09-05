import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
import { useToast } from "@/hooks/use-toast";
import { ActionLoader } from "@/components/action-loader";

export type CreatedCustomer = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  category: string;
  loyaltyPoints: number;
};

export type NewCustomerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fills the name, so typing into a customer search and finding nothing is not a dead end. */
  initialName?: string;
  /** Where the customer came from, recorded on the record. */
  source?: string;
  onCreated: (customer: CreatedCustomer) => void;
};

/**
 * Add a customer without leaving what you were doing.
 *
 * The customer picker used to list only customers that already existed, so a
 * new face at the counter meant abandoning a half-built order, going to
 * Customers, adding them, and coming back to start again. Nobody does that
 * mid-queue — they ring it through as a walk-in, and the customer is never on
 * the system at all.
 *
 * Only the name is required: everything else can be filled in later from the
 * Customers page, and asking for more at the till is how a form stops getting
 * used.
 */
export function NewCustomerDialog({
  open,
  onOpenChange,
  initialName,
  source = "pos",
  onCreated,
}: NewCustomerDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const nameRef = useRef<HTMLInputElement>(null);

  // Seed from whatever was typed into the search that came up empty. The seed
  // cannot change while the dialog is up — the picker that holds that search is
  // closed — so this only ever fires on open, and never over live typing.
  useEffect(() => {
    if (!open) return;
    setName(initialName?.trim() ?? "");
    setPhone("");
    setEmail("");
  }, [open, initialName]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/customers", {
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        source,
      });
      return (await response.json()) as CreatedCustomer;
    },
    onSuccess: async (customer) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      onCreated(customer);
      onOpenChange(false);
      toast({
        title: "Customer added",
        description: `${customer.name} is on the system and selected for this order.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not add the customer",
        description:
          error?.message ||
          "The customer was not saved. Check the connection and try again.",
        variant: "destructive",
      });
    },
  });

  // Queueing this one offline is not offered: the queue returns no id, and an
  // order cannot be attached to a customer that does not exist yet. Saying so
  // beats a success toast followed by a walk-in sale.
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const canSave = name.trim().length > 0 && !createMutation.isPending && !offline;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[425px]"
        // Without this the dialog opens with the close button focused, and the
        // one field that has to be filled in is a tab away.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Add a new customer</DialogTitle>
          <DialogDescription>
            {offline
              ? "You are offline. A new customer needs a connection — ring this through as a walk-in and add them when you are back online."
              : "Name is all that is needed now. The rest can be filled in later."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) createMutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="new-customer-name">Name</Label>
            <Input
              id="new-customer-name"
              ref={nameRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="min-h-[44px]"
              required
              data-testid="input-new-customer-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-customer-phone">Phone (optional)</Label>
            <Input
              id="new-customer-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="min-h-[44px]"
              inputMode="tel"
              data-testid="input-new-customer-phone"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-customer-email">Email (optional)</Label>
            <Input
              id="new-customer-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="min-h-[44px]"
              inputMode="email"
              data-testid="input-new-customer-email"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSave}
              className="min-h-[44px] gap-2"
              data-testid="button-save-new-customer"
            >
              {createMutation.isPending ? (
                <>
                  <ActionLoader className="text-primary-foreground" />
                  Adding…
                </>
              ) : (
                "Add customer"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
