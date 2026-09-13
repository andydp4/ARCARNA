import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { apiFetch } from "@/lib/appPaths";
import { queryClient } from "@/lib/queryClient";
import { invalidateEndpointFamily } from "@/lib/query-invalidation";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { BoardOrder } from "@/lib/orderTypes";

/**
 * Rating a completed order, from the card it is already on.
 *
 * `SatisfactionDialog` is replaced by rating chips (brief, "Changes from
 * revision 1"): the same one tap the dialog asked for — a 1–5 score feeding
 * `POST /api/satisfaction` and ARC-T2-003 — without a modal over a board a
 * cashier may be mid-tap on. Completed cards only, per the brief's card
 * overflow ("Rate … completed cards only"); a card that is still open has no
 * collection or delivery to rate yet.
 */
export interface OpsRateChipsProps {
  order: BoardOrder;
}

const SCORE_LABEL: Record<number, string> = {
  1: "Very poor",
  2: "Poor",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

export function OpsRateChips({ order }: OpsRateChipsProps) {
  const { toast } = useToast();
  const [score, setScore] = useState<number | null>(null);

  const rate = useMutation({
    mutationFn: async (value: number) => {
      const response = await apiFetch("/api/satisfaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, customerId: order.customerId ?? undefined, score: value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || "Could not save the rating");
      return body;
    },
    onSuccess: (_data, value) => {
      setScore(value);
      toast({
        title: "Rating saved",
        description:
          value <= 2
            ? "Flagged for follow-up — it will appear in the Customer Satisfaction report."
            : "Thanks — it will appear in the Customer Satisfaction report.",
      });
      void invalidateEndpointFamily(queryClient, "/api/satisfaction");
      void invalidateEndpointFamily(queryClient, "/api/reports");
    },
    onError: (error: Error) => {
      toast({ title: "Could not save the rating", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div data-testid={`ops-rate-chips-${order.id}`}>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">
        {order.customerName ? `Rate ${order.customerName}'s experience` : "Rate this customer's experience"}
      </h3>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`Satisfaction score for order ${order.shortCode}`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={score === n}
            aria-label={`${n} out of 5 — ${SCORE_LABEL[n]}`}
            disabled={rate.isPending}
            onClick={() => rate.mutate(n)}
            data-testid={`ops-rate-${order.id}-${n}`}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-lg border transition disabled:opacity-50",
              score !== null && n <= score
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            <Star className={cn("h-5 w-5", score !== null && n <= score && "fill-current")} aria-hidden />
          </button>
        ))}
      </div>
      <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
        {score ? SCORE_LABEL[score] : "Tap a star to rate"}
      </p>
    </div>
  );
}
