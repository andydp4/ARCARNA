/**
 * "Send payment reminder" on the Credit List (v1.2 Phase 6, PRV-11): the
 * server sends the approved WhatsApp payment reminder, with what they owe, to
 * the number on file. Nobody here sees the number; the send is logged. Off,
 * with the reason, when WhatsApp or the template is not ready.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type Status = { messages: Array<{ message: string; available: boolean; reason: string | null }>; costNote: string };

export function PaymentReminderButton({ customerId, disabled, className }: { customerId: string; disabled?: boolean; className?: string }) {
  const { toast } = useToast();
  const { data } = useQuery<Status>({ queryKey: ["/api/messaging/status"], staleTime: 60_000 });
  const option = data?.messages.find((m) => m.message === "payment_reminder");
  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/customers/${customerId}/message`, { message: "payment_reminder" })).json(),
    onSuccess: () => toast({ title: "Payment reminder sent", description: "WhatsApp sent it to the number on file." }),
    onError: (e: Error) => toast({ title: "Not sent", description: e.message, variant: "destructive" }),
  });
  const reason = option && !option.available ? option.reason ?? "Not available." : null;
  return (
    <Button
      size="sm"
      variant="outline"
      className={cn(className)}
      disabled={disabled || !option?.available || send.isPending}
      title={reason ?? data?.costNote}
      aria-label={reason ? `Send payment reminder (off: ${reason})` : "Send payment reminder"}
      onClick={() => send.mutate()}
      data-testid={`button-payment-reminder-${customerId}`}
    >
      <MessageCircle className="h-4 w-4 mr-1" aria-hidden />
      Send payment reminder
    </Button>
  );
}

/** One line above the list saying why "Send payment reminder" is off, when it is. */
export function PaymentReminderNote() {
  const { data } = useQuery<Status>({ queryKey: ["/api/messaging/status"], staleTime: 60_000 });
  const option = data?.messages.find((m) => m.message === "payment_reminder");
  if (!option) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="text-payment-reminder-note">
      {option.available ? `Payment reminders go by WhatsApp to the number on file. ${data?.costNote ?? ""}` : `"Send payment reminder" is off: ${option.reason}`}
    </p>
  );
}
