import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Activity, AlertCircle, Info, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export type ActivityTimelineItem = {
  id: string;
  source: string;
  entityType: string;
  entityId: string;
  title: string;
  detail: string | null;
  occurredAt: string;
  severity: "info" | "warning" | "error";
};

interface ActivityTimelineProps {
  entityType?: string;
  entityId?: string;
  limit?: number;
  className?: string;
  emptyMessage?: string;
}

function SeverityIcon({ severity }: { severity: ActivityTimelineItem["severity"] }) {
  if (severity === "error") return <AlertCircle className="h-4 w-4 text-destructive shrink-0" />;
  if (severity === "warning") return <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <Info className="h-4 w-4 text-muted-foreground shrink-0" />;
}

export function ActivityTimeline({
  entityType,
  entityId,
  limit = 30,
  className,
  emptyMessage = "No activity recorded yet.",
}: ActivityTimelineProps) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (entityType) params.set("entityType", entityType);
  if (entityId) params.set("entityId", entityId);
  const url = `/api/activity?${params.toString()}`;

  const { data, isLoading, isError } = useQuery<{ items: ActivityTimelineItem[] }>({
    queryKey: [url],
  });

  if (isLoading) {
    return (
      <div className={cn("space-y-3", className)}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className={cn("text-sm text-muted-foreground py-4", className)}>
        Activity feed unavailable.
      </p>
    );
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className={cn("text-center py-10 text-muted-foreground", className)}>
        <Activity className="h-10 w-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ul className={cn("space-y-0 border-l border-border ml-2", className)} data-testid="activity-timeline">
      {items.map((item) => (
        <li key={item.id} className="relative pl-6 pb-6 last:pb-0">
          <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-border ring-2 ring-background" />
          <div className="flex gap-2">
            <SeverityIcon severity={item.severity} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug">{item.title}</p>
              {item.detail && (
                <p className="text-xs text-muted-foreground truncate">{item.detail}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Package className="h-3 w-3" />
                {item.entityType} · {formatDistanceToNow(new Date(item.occurredAt), { addSuffix: true })}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
