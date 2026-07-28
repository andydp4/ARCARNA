/**
 * Post-collection satisfaction capture (feeds ARC-T2-003).
 *
 * Deliberately one tap: five faces/stars, optional comment, done. Anything
 * heavier does not get filled in on a busy counter, and an unused capture
 * screen means an empty report.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/appPaths";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SatisfactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId?: string;
  customerId?: string;
  customerName?: string;
}

const SCORE_LABEL: Record<number, string> = {
  1: "Very poor",
  2: "Poor",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

export function SatisfactionDialog({
  open,
  onOpenChange,
  orderId,
  customerId,
  customerName,
}: SatisfactionDialogProps) {
  const { toast } = useToast();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/satisfaction", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, customerId, score, comment: comment.trim() || undefined }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message || "Failed to save rating");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Rating saved",
        description:
          score && score <= 2
            ? "Flagged for follow-up — it will appear in the Customer Satisfaction report."
            : "Thanks — it will appear in the Customer Satisfaction report.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/satisfaction"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports", "ARC-T2-003"] });
      reset();
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast({ title: "Could not save rating", description: e.message, variant: "destructive" }),
  });

  function reset() {
    setScore(null);
    setComment("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>How was the collection?</DialogTitle>
          <DialogDescription>
            {customerName ? `Rating ${customerName}'s experience.` : "Rate this customer's experience."} One tap is
            enough.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <div className="flex justify-center gap-2" role="radiogroup" aria-label="Satisfaction score">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={score === n}
                aria-label={`${n} out of 5 — ${SCORE_LABEL[n]}`}
                onClick={() => setScore(n)}
                data-testid={`score-${n}`}
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-lg border transition",
                  score !== null && n <= score
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40",
                )}
              >
                <Star className={cn("h-5 w-5", score !== null && n <= score && "fill-current")} />
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-sm text-muted-foreground" aria-live="polite">
            {score ? SCORE_LABEL[score] : "Tap a star to rate"}
          </p>

          <div className="mt-4 space-y-2">
            <Label htmlFor="satisfaction-comment">Anything they said? (optional)</Label>
            <Textarea
              id="satisfaction-comment"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Their words help more than the number."
              data-testid="input-satisfaction-comment"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Skip
          </Button>
          <Button
            disabled={score === null || submit.isPending}
            onClick={() => submit.mutate()}
            data-testid="button-save-satisfaction"
          >
            {submit.isPending ? "Saving…" : "Save rating"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
