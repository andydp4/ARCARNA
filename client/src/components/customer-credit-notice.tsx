/**
 * "This customer already owes" at order start (v1.2.1 credit).
 *
 * Shown wherever an order is started for a customer — the till, the
 * Operations Centre's order form and phone orders all use the same form — as
 * soon as a customer with a Credit List balance is chosen. It says how much,
 * over how many tabs and since when, and reminds staff to record any payment
 * against the credit. It never blocks the sale: it is information, and Take a
 * payment sits beside it for when the customer settles some or all of it.
 *
 * Take a payment goes through the server's one repayment path (oldest tab
 * first), so the ledger, the drawer's expected cash, the shift summary and
 * commission all follow. The server is the judge: the form only mirrors its
 * rules (cash or card, today, no more than is owed).
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionLoader } from "@/components/action-loader";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getJson } from "@/lib/queryClient";
import { invalidateEndpointFamily } from "@/lib/query-invalidation";
import { recordCreditNotice } from "@/lib/usage";
import { cn } from "@/lib/utils";
import {
  customerCreditNotice,
  TILL_CREDIT_PAYMENT_METHODS,
  type CustomerCreditSummary,
  type TillCreditPaymentMethod,
} from "@shared/customerCredit";

export const customerCreditSummaryKey = (customerId: string) => ["/api/customers", customerId, "credit-summary"] as const;

/** One "shown" per customer chosen, however many times the form re-renders or steps. */
let lastShownFor: string | null = null;

type PaymentResult = {
  amountPaid: number;
  method: TillCreditPaymentMethod;
  tabsPaid: number;
  summary: CustomerCreditSummary;
};

const METHOD_LABEL: Record<TillCreditPaymentMethod, string> = { cash: "Cash", card: "Card" };

export function CustomerCreditNotice({
  customerId,
  disabled = false,
  className,
}: {
  customerId: string | null | undefined;
  disabled?: boolean;
  className?: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<TillCreditPaymentMethod | "">("");
  const [problem, setProblem] = useState<string | null>(null);

  const { data } = useQuery<CustomerCreditSummary>({
    queryKey: customerId ? customerCreditSummaryKey(customerId) : ["/api/customers", "none", "credit-summary"],
    queryFn: () => getJson<CustomerCreditSummary>(`/api/customers/${customerId}/credit-summary`),
    enabled: !!customerId,
    // Offline or refused: say nothing rather than hold the sale up.
    retry: false,
    staleTime: 15_000,
  });

  const notice = data && data.customerId === customerId ? customerCreditNotice(data) : null;

  useEffect(() => {
    if (notice && customerId && lastShownFor !== customerId) {
      lastShownFor = customerId;
      recordCreditNotice("shown");
    }
    if (!customerId) lastShownFor = null;
  }, [notice, customerId]);

  // A different customer starts with the form closed.
  useEffect(() => {
    setPaying(false);
    setProblem(null);
  }, [customerId]);

  const payMutation = useMutation({
    mutationFn: async (): Promise<PaymentResult> => {
      const res = await apiRequest("POST", `/api/customers/${customerId}/credit-payments`, {
        amount: Number(amount),
        method,
      });
      return (await res.json()) as PaymentResult;
    },
    onSuccess: async (result) => {
      recordCreditNotice("paid");
      queryClient.setQueryData(customerCreditSummaryKey(result.summary.customerId), result.summary);
      setPaying(false);
      setProblem(null);
      const left =
        result.summary.owed > 0 ? ` £${result.summary.owed.toFixed(2)} is still owed.` : " Their credit is clear.";
      toast({
        title: "Payment recorded",
        description: `£${result.amountPaid.toFixed(2)} by ${result.method} against their credit.${left}${
          result.method === "cash" ? " It is in this till's expected cash." : ""
        }`,
      });
      await Promise.all([
        invalidateEndpointFamily(queryClient, "/api/shifts"),
        invalidateEndpointFamily(queryClient, "/api/cashier-shifts"),
        invalidateEndpointFamily(queryClient, "/api/tick-customers"),
        invalidateEndpointFamily(queryClient, "/api/invoices"),
        invalidateEndpointFamily(queryClient, "/api/control-centre"),
      ]);
    },
    onError: (error: Error) => {
      setProblem(error.message);
      toast({ title: "Could not record the payment", description: error.message, variant: "destructive" });
    },
  });

  if (!customerId || !notice || !data) return null;

  const typed = Number(amount);
  const amountOk = amount.trim() !== "" && Number.isFinite(typed) && typed > 0 && Math.round(typed * 100) / 100 <= data.owed;
  const canSubmit = amountOk && method !== "" && !payMutation.isPending && !disabled;

  return (
    <div
      role="status"
      className={cn("rounded-lg border px-3 py-2 text-sm", className)}
      style={{
        borderColor: "color-mix(in srgb, var(--warning) 55%, var(--border))",
        backgroundColor: "color-mix(in srgb, var(--warning) 12%, var(--card))",
      }}
      data-testid="customer-credit-notice"
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground" data-testid="customer-credit-owed">
            {notice.headline}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="customer-credit-detail">
            {notice.detail}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{notice.reminder}</p>
        </div>
      </div>

      {!paying ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2 min-h-11"
          disabled={disabled}
          onClick={() => {
            setAmount(data.owed.toFixed(2));
            setMethod("");
            setProblem(null);
            setPaying(true);
          }}
          data-testid="button-take-credit-payment"
        >
          Take a payment
        </Button>
      ) : (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) payMutation.mutate();
          }}
          data-testid="credit-payment-form"
        >
          <div className="space-y-1">
            <Label htmlFor="credit-payment-amount" className="text-xs">
              Amount paid (up to £{data.owed.toFixed(2)})
            </Label>
            <Input
              id="credit-payment-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="min-h-11"
              data-testid="input-credit-payment-amount"
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium" id="credit-payment-method-label">
              Paid by
            </span>
            <div className="flex gap-2" role="radiogroup" aria-labelledby="credit-payment-method-label">
              {TILL_CREDIT_PAYMENT_METHODS.map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  role="radio"
                  aria-checked={method === m}
                  variant={method === m ? "default" : "outline"}
                  className="min-h-11 flex-1"
                  onClick={() => setMethod(m)}
                  data-testid={`chip-credit-payment-${m}`}
                >
                  {METHOD_LABEL[m]}
                </Button>
              ))}
            </div>
          </div>
          {problem && (
            <p className="text-xs text-destructive" role="alert" data-testid="credit-payment-problem">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" className="min-h-11" disabled={!canSubmit} data-testid="button-record-credit-payment">
              {payMutation.isPending ? (
                <>
                  <ActionLoader className="text-primary-foreground" />
                  Recording…
                </>
              ) : (
                "Record payment"
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-11"
              disabled={payMutation.isPending}
              onClick={() => setPaying(false)}
              data-testid="button-cancel-credit-payment"
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
