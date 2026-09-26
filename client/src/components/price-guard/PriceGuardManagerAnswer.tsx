import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

/**
 * "Manager agreed: Alex" asks Alex (v1.2 Phase 4, CMP-05). Shown on that one
 * Signal in Alex's bell. A "No" goes to the owner; the sale stands either way.
 */
export function PriceGuardManagerAnswer({ checkId }: { checkId: string }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const answer = async (value: "yes" | "no") => {
    setState("sending");
    try {
      await apiRequest("POST", `/api/price-guard/checks/${checkId}/answer`, { answer: value });
      setMessage(value === "yes" ? "Thanks — recorded that you agreed." : "Recorded. The owner has been told; the sale stands.");
      setState("done");
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not record the answer.");
      setState(/already answered/i.test(String((e as Error)?.message)) ? "done" : "idle");
    }
  };

  if (state === "done") {
    return (
      <p className="mt-2 text-xs text-muted-foreground" data-testid={`price-guard-answer-done-${checkId}`}>
        {message}
      </p>
    );
  }
  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-9"
          disabled={state === "sending"}
          onClick={() => answer("yes")}
          data-testid={`price-guard-answer-yes-${checkId}`}
        >
          Yes, I agreed
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9"
          disabled={state === "sending"}
          onClick={() => answer("no")}
          data-testid={`price-guard-answer-no-${checkId}`}
        >
          No
        </Button>
      </div>
      {message && <p className="text-xs text-destructive">{message}</p>}
    </div>
  );
}
