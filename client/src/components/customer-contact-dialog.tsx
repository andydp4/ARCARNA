/**
 * Contacting a customer (v1.2 Phase 6, PRV-09/10/11).
 *
 * "Message the customer instead" comes first: the server sends an approved
 * WhatsApp template to the number on file, and nobody here sees the number.
 * Below it, a manager can ask for the details themselves — reason, a note of
 * at least 15 characters, the fields wanted, optionally the order — and an
 * admin or the owner approves. Inside the 24 hours each field is shown only
 * when tapped, and every tap is logged on the server before the value comes
 * back.
 *
 * Revealed values live in this component's state only: never in the query
 * cache, never in storage, and the server marks them no-store so the service
 * worker and the browser do not keep them either. They are wiped when the
 * dialog closes, when access ends, and by a timer at the moment it expires.
 *
 * Admins get the per-customer "Access history" tab (PRV-10).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Eye, History, MessageCircle, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, getJson, queryClient } from "@/lib/queryClient";
import { canSeeContactDetails } from "@shared/accessPolicy";
import {
  ACCESS_ACTION_LABELS,
  CONTACT_FIELD_LABELS,
  CONTACT_FIELDS_REQUESTABLE,
  CONTACT_NOTE_MIN,
  CONTACT_REASONS,
  CONTACT_REASON_LABELS,
  GRANT_HOURS,
  PENDING_EXPIRY_HOURS,
  contactAccessRecheckMs,
  type AccessAction,
  type ContactField,
  type ContactReason,
  type CustomerMessage,
} from "@shared/contactAccess";

type MessageOption = { message: CustomerMessage; label: string; available: boolean; reason: string | null; needsOrder: boolean };

type ContactAccess = {
  canRequest: boolean;
  seesContact: boolean;
  grant: { id: string; fields: string[]; grantExpiresAt: string; reason: string } | null;
  pending: { id: string; fields: string[]; expiresAt: string; reason: string; createdAt: string } | null;
  messaging: { whatsapp: boolean; email: boolean; emailReason: string | null; costNote: string; messages: MessageOption[] };
  recentOrders: Array<{ id: string; ref: string; status: string | null; createdAt: string | null }>;
  serverNow: string;
};

type AccessRow = {
  id: string;
  actorName: string;
  actorRole: string;
  action: string;
  field: string | null;
  orderId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function OrderPicker({
  orders,
  value,
  onChange,
  optional,
  testId,
}: {
  orders: ContactAccess["recentOrders"];
  value: string;
  onChange: (v: string) => void;
  optional: boolean;
  testId: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="min-h-[44px]" data-testid={testId} aria-label={optional ? "Order (optional)" : "Order"}>
        <SelectValue placeholder={optional ? "No order (optional)" : "Pick the order"} />
      </SelectTrigger>
      <SelectContent>
        {optional && <SelectItem value="none">No order</SelectItem>}
        {orders.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.ref} · {when(o.createdAt)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "Message the customer instead": offered first, to everyone who can open this. */
function MessageInstead({ customerId, access }: { customerId: string; access: ContactAccess }) {
  const { toast } = useToast();
  const options = access.messaging.messages;
  const firstAvailable = options.find((o) => o.available)?.message ?? options[0]?.message;
  const [message, setMessage] = useState<CustomerMessage | undefined>(firstAvailable);
  const [orderId, setOrderId] = useState<string>("");
  const chosen = options.find((o) => o.message === message);
  const send = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/customers/${customerId}/message`, { message, orderId: orderId && orderId !== "none" ? orderId : null })).json(),
    onSuccess: () => toast({ title: "Message sent", description: "WhatsApp sent it to the number on file." }),
    onError: (e: Error) => toast({ title: "Not sent", description: e.message, variant: "destructive" }),
  });
  const needsOrder = !!chosen?.needsOrder;
  const canSend = !!chosen?.available && (!needsOrder || (!!orderId && orderId !== "none"));

  return (
    <section className="space-y-3 rounded-md border p-4" data-testid="section-message-instead">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-4 w-4" />
        <h3 className="text-sm font-semibold">Message the customer instead</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        We send an approved WhatsApp message to the number on file. You never see the number. {access.messaging.costNote}
      </p>
      <div className="space-y-2">
        <Label className="text-xs">Message</Label>
        <Select value={message} onValueChange={(v) => setMessage(v as CustomerMessage)}>
          <SelectTrigger aria-label="Message" className="min-h-[44px]" data-testid="select-customer-message">
            <SelectValue placeholder="Pick a message" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.message} value={o.message}>
                {o.label}
                {o.available ? "" : " (not available)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {chosen && !chosen.available && chosen.reason && (
          <p className="text-xs text-muted-foreground" data-testid="text-message-unavailable">
            {chosen.reason}
          </p>
        )}
      </div>
      {needsOrder && (
        <div className="space-y-2">
          <Label className="text-xs">Order</Label>
          {access.recentOrders.length === 0 ? (
            <p className="text-xs text-muted-foreground">This customer has no orders.</p>
          ) : (
            <OrderPicker orders={access.recentOrders} value={orderId} onChange={setOrderId} optional={false} testId="select-message-order" />
          )}
        </div>
      )}
      <Button className="min-h-[44px]" disabled={!canSend || send.isPending} onClick={() => send.mutate()} data-testid="button-send-customer-message">
        Send message
      </Button>
    </section>
  );
}

/** The request form: reason, note (15+ characters), fields, optional order. */
function RequestForm({ customerId, access }: { customerId: string; access: ContactAccess }) {
  const { toast } = useToast();
  const [reason, setReason] = useState<ContactReason | "">("");
  const [note, setNote] = useState("");
  const [fields, setFields] = useState<ContactField[]>(["phone"]);
  const [orderId, setOrderId] = useState("none");
  const noteOk = note.trim().length >= CONTACT_NOTE_MIN;
  const submit = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", `/api/customers/${customerId}/contact-requests`, {
          reason,
          note: note.trim(),
          fields,
          orderId: orderId === "none" ? null : orderId,
        })
      ).json(),
    onSuccess: () => {
      toast({ title: "Request sent", description: "An admin will approve or decline it. It lapses after 48 hours." });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "contact-access"] });
    },
    onError: (e: Error) => toast({ title: "Not sent", description: e.message, variant: "destructive" }),
  });
  const toggle = (f: ContactField, on: boolean) => setFields((cur) => (on ? [...new Set([...cur, f])] : cur.filter((x) => x !== f)));

  return (
    <div className="space-y-3" data-testid="form-contact-request">
      <div className="space-y-2">
        <Label className="text-xs">Reason</Label>
        <Select value={reason} onValueChange={(v) => setReason(v as ContactReason)}>
          <SelectTrigger aria-label="Reason" className="min-h-[44px]" data-testid="select-contact-reason">
            <SelectValue placeholder="Pick a reason" />
          </SelectTrigger>
          <SelectContent>
            {CONTACT_REASONS.map((r) => (
              <SelectItem key={r} value={r}>
                {CONTACT_REASON_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-note" className="text-xs">
          Why do you need them? (at least {CONTACT_NOTE_MIN} characters)
        </Label>
        <Textarea id="contact-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-contact-note" />
        {!noteOk && note.length > 0 && (
          <p className="text-xs text-muted-foreground">{CONTACT_NOTE_MIN - note.trim().length} more characters.</p>
        )}
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Details wanted</legend>
        <div className="flex flex-wrap gap-4">
          {CONTACT_FIELDS_REQUESTABLE.map((f) => (
            <label key={f} className="flex min-h-[44px] items-center gap-2 text-sm">
              <Checkbox checked={fields.includes(f)} onCheckedChange={(v) => toggle(f, v === true)} data-testid={`checkbox-field-${f}`} />
              {CONTACT_FIELD_LABELS[f]}
            </label>
          ))}
        </div>
      </fieldset>
      {access.recentOrders.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs">About an order (optional)</Label>
          <OrderPicker orders={access.recentOrders} value={orderId} onChange={setOrderId} optional testId="select-request-order" />
        </div>
      )}
      <Button
        className="min-h-[44px]"
        variant="outline"
        disabled={!reason || !noteOk || fields.length === 0 || submit.isPending}
        onClick={() => submit.mutate()}
        data-testid="button-send-contact-request"
      >
        Ask an admin
      </Button>
    </div>
  );
}

/**
 * Inside the grant: a button per field; the value is fetched on the tap and
 * kept only here. Cleared when access ends — by the timer at expiry, by "End
 * access now", or when the dialog closes.
 */
function GrantPanel({ customerId, access }: { customerId: string; access: ContactAccess }) {
  const { toast } = useToast();
  const grant = access.grant!;
  const [revealed, setRevealed] = useState<Partial<Record<ContactField, string | null>>>({});
  // Server time minus device time, so a wrong device clock does not stretch the grant.
  const skew = useMemo(() => new Date(access.serverNow).getTime() - Date.now(), [access.serverNow]);
  const endsAt = new Date(grant.grantExpiresAt).getTime();

  useEffect(() => {
    const ms = endsAt - (Date.now() + skew);
    const clear = () => {
      setRevealed({});
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "contact-access"] });
    };
    if (ms <= 0) {
      clear();
      return;
    }
    // setTimeout's ceiling is ~24.8 days; a grant is 24 hours, well inside it.
    const timer = window.setTimeout(clear, ms);
    return () => window.clearTimeout(timer);
  }, [endsAt, skew, customerId]);

  const reveal = useMutation({
    mutationFn: async (field: ContactField) =>
      (await (await apiRequest("POST", `/api/customers/${customerId}/reveal`, { field })).json()) as { field: ContactField; value: string | null },
    onSuccess: (out) => setRevealed((cur) => ({ ...cur, [out.field]: out.value })),
    onError: (e: Error) => {
      toast({ title: "Not shown", description: e.message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "contact-access"] });
    },
  });
  const end = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/contact-requests/${grant.id}/end`)).json(),
    onSuccess: () => {
      setRevealed({});
      toast({ title: "Access ended" });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "contact-access"] });
    },
    onError: (e: Error) => toast({ title: "Could not end access", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3" data-testid="panel-contact-grant">
      <p className="text-xs text-muted-foreground">
        Approved until {when(grant.grantExpiresAt)}. Each detail is shown when you tap it, and every look is logged.
      </p>
      <div className="space-y-2">
        {(grant.fields as ContactField[]).map((f) => (
          <div key={f} className="flex flex-wrap items-center gap-3">
            <span className="w-28 text-sm font-medium">{CONTACT_FIELD_LABELS[f]}</span>
            {f in revealed ? (
              <span className="select-all text-sm" data-testid={`text-revealed-${f}`}>
                {revealed[f] ?? "Nothing on file"}
              </span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="min-h-[44px] gap-2"
                disabled={reveal.isPending}
                onClick={() => reveal.mutate(f)}
                data-testid={`button-reveal-${f}`}
              >
                <Eye className="h-4 w-4" />
                Show {CONTACT_FIELD_LABELS[f].toLowerCase()}
              </Button>
            )}
          </div>
        ))}
      </div>
      <Button variant="ghost" className="min-h-[44px]" disabled={end.isPending} onClick={() => end.mutate()} data-testid="button-end-contact-access">
        End access now
      </Button>
    </div>
  );
}

function AccessHistory({ customerId }: { customerId: string }) {
  const { data, isLoading, isError } = useQuery<AccessRow[]>({
    queryKey: ["/api/customers", customerId, "access-history"],
    queryFn: () => getJson(`/api/customers/${customerId}/access-history`),
    staleTime: 0,
    gcTime: 0,
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError) return <p className="text-sm text-destructive">Could not load the access history.</p>;
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground">Nobody has looked at or changed this customer's contact details.</p>;
  return (
    <ul className="max-h-[50vh] space-y-2 overflow-y-auto" data-testid="list-access-history">
      {data.map((row) => (
        <li key={row.id} className="rounded-md border p-3 text-sm" data-testid={`access-row-${row.action}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{ACCESS_ACTION_LABELS[row.action as AccessAction] ?? row.action}</Badge>
            {row.field && <span className="text-xs">{CONTACT_FIELD_LABELS[row.field as ContactField] ?? row.field}</span>}
            <span className="font-medium">{row.actorName}</span>
            <span className="text-xs text-muted-foreground">{when(row.createdAt)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CustomerContactDialog({
  customer,
  open,
  onOpenChange,
}: {
  customer: { id: string; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const isAdmin = canSeeContactDetails(user?.role);
  const customerId = customer?.id ?? "";
  const { data: access, isLoading, isError } = useQuery<ContactAccess>({
    queryKey: ["/api/customers", customerId, "contact-access"],
    queryFn: () => getJson(`/api/customers/${customerId}/contact-access`),
    enabled: open && !!customerId,
    staleTime: 0,
    gcTime: 0,
    // A revoke is not pushed to this device: while a grant is showing, re-check
    // so revealed values and the reveal buttons go soon after, not at expiry.
    refetchInterval: (query) => contactAccessRecheckMs(query.state.data),
    refetchOnWindowFocus: true,
  });
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) queryClient.removeQueries({ queryKey: ["/api/customers", customerId, "access-history"] });
    wasOpen.current = open;
  }, [open, customerId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Contact {customer?.name ?? "customer"}</DialogTitle>
          <DialogDescription>Message them first. Asking for their details needs an admin's approval.</DialogDescription>
        </DialogHeader>
        {open && customer && (
          <Tabs defaultValue="contact">
            {isAdmin && (
              <TabsList>
                <TabsTrigger value="contact">Contact</TabsTrigger>
                <TabsTrigger value="history" data-testid="tab-access-history">
                  <History className="mr-1 h-4 w-4" />
                  Access history
                </TabsTrigger>
              </TabsList>
            )}
            <TabsContent value="contact" className="space-y-4">
              {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
              {isError && <p className="text-sm text-destructive">Could not load this customer's contact options.</p>}
              {access && (
                <>
                  <MessageInstead customerId={customer.id} access={access} />
                  {access.seesContact ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ShieldCheck className="h-4 w-4" />
                      As an admin you see their details on the customer already.
                    </p>
                  ) : access.canRequest ? (
                    <section className="space-y-3 rounded-md border p-4" data-testid="section-contact-request">
                      <h3 className="text-sm font-semibold">Still need their details?</h3>
                      {access.grant ? (
                        <GrantPanel key={access.grant.id} customerId={customer.id} access={access} />
                      ) : access.pending ? (
                        <p className="text-sm" data-testid="text-contact-pending">
                          Waiting for an admin since {when(access.pending.createdAt)}. It lapses at {when(access.pending.expiresAt)} if nobody decides.
                        </p>
                      ) : (
                        <>
                          <p className="text-xs text-muted-foreground">
                            An admin approves it; you then have {GRANT_HOURS} hours. A request nobody answers lapses after {PENDING_EXPIRY_HOURS} hours.
                          </p>
                          <RequestForm customerId={customer.id} access={access} />
                        </>
                      )}
                    </section>
                  ) : null}
                </>
              )}
            </TabsContent>
            {isAdmin && (
              <TabsContent value="history">
                <AccessHistory customerId={customer.id} />
              </TabsContent>
            )}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
