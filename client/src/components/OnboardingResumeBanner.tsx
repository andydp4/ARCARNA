import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/appPaths";

type OnboardingPayload = {
  isComplete: boolean;
  completedCount: number;
  totalSteps: number;
};

export function OnboardingResumeBanner() {
  const { data } = useQuery<OnboardingPayload>({
    queryKey: ["/api/onboarding"],
    queryFn: async () => {
      const res = await apiFetch("/api/onboarding");
      if (!res.ok) throw new Error("Failed to load onboarding");
      return res.json();
    },
    staleTime: 30_000,
  });

  if (!data || data.isComplete) return null;

  const remaining = data.totalSteps - data.completedCount;

  return (
    <div
      className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      role="status"
      data-testid="onboarding-resume-banner"
    >
      <div className="flex items-start gap-3">
        <Sparkles className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
        <div>
          <p className="font-medium text-foreground">
            Finish setting up your shop ({data.completedCount} of {data.totalSteps} done)
          </p>
          <p className="text-sm text-muted-foreground">
            {remaining} step{remaining === 1 ? "" : "s"} left — takes about 5 minutes.
          </p>
        </div>
      </div>
      <Button asChild className="min-h-[44px] shrink-0" variant="default">
        <Link href="/onboarding/wizard">
          Resume setup
          <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
