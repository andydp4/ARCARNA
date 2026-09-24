/**
 * The My performance card (v1.2 Phase 7C) on the Control Centre, for every
 * role: today's own figures at a glance, provisional until the day closes,
 * with a link to the full page. Own figures only; nothing is kept on the
 * device (the server says no-store, and the query is dropped when unmounted).
 */
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getJson } from "@/lib/queryClient";
import type { MyPerformance } from "@/pages/my-performance";
import { KpisMet, money } from "./PeopleFigures";

export function MyPerformanceCard() {
  const { data } = useQuery<MyPerformance>({
    queryKey: ["/api/my-performance", "card"],
    queryFn: () => getJson("/api/my-performance"),
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 120_000,
  });
  if (!data) return null;
  return (
    <Card className="lm-card border-0 shadow-none" data-testid="card-my-performance">
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-6 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <Gauge className="h-4 w-4" aria-hidden /> My performance today
          {data.includesToday && <Badge variant="secondary">Provisional</Badge>}
        </span>
        <span>Completed <b>{data.figures.completed}</b></span>
        <span>Brought in <b>{money(data.figures.valueBroughtIn)}</b></span>
        <span>Commission <b>{money(data.commission)}</b></span>
        <KpisMet kpis={data.kpis} />
        {data.badges.length > 0 && <span>{data.badges.length} badge{data.badges.length === 1 ? "" : "s"}</span>}
        <Link href="/my-performance" className="ml-auto underline underline-offset-2" data-testid="link-my-performance-card">
          See more
        </Link>
      </CardContent>
    </Card>
  );
}
