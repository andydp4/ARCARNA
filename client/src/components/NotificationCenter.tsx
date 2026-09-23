import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { STORAGE_NOTIFICATIONS_DISMISSED } from "@shared/storageKeys";
import { PriceGuardManagerAnswer } from "@/components/price-guard/PriceGuardManagerAnswer";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "error";
  createdAt: string;
  persisted?: boolean;
  readAt?: string | null;
  entityType?: string;
  entityId?: string;
};

/*
 * Read and cleared are per person (v1.2 Phase 0B). Stored Signals keep that
 * state on the server, so clearing one on this account leaves it on everyone
 * else's — the till is often a shared device, which is why this no longer
 * lives in the browser. Only the computed Signals (stock, approvals), which
 * have no server row, are remembered locally, and then per account.
 */
function storageKeyFor(userId: string | undefined): string {
  return `${STORAGE_NOTIFICATIONS_DISMISSED}:${userId ?? "anon"}`;
}

function loadDismissed(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveDismissed(key: string, ids: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    /* storage unavailable: dismissal lasts for this session only */
  }
}

export function NotificationCenter() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const storageKey = storageKeyFor(user?.id);
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed(storageKey));
  const [read, setRead] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setDismissed(loadDismissed(storageKey));
    setRead(new Set());
  }, [storageKey]);

  const { data } = useQuery<{ items: NotificationItem[] }>({
    queryKey: ["/api/notifications"],
    refetchInterval: 60000,
  });

  const visible = useMemo(() => {
    return (data?.items ?? []).filter((n) => n.persisted || !dismissed.has(n.id));
  }, [data?.items, dismissed]);

  const isUnread = (n: NotificationItem) => (n.persisted ? !n.readAt : !read.has(n.id));
  const unreadCount = visible.filter(isUnread).length;

  const dismiss = async (n: NotificationItem) => {
    if (n.persisted) {
      try {
        await apiRequest("POST", `/api/org-notifications/${n.id}/dismiss`);
      } catch {
        /* ignore: it stays in the list and can be cleared again */
      }
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      return;
    }
    const next = new Set(dismissed);
    next.add(n.id);
    setDismissed(next);
    saveDismissed(storageKey, next);
  };

  const markAllRead = async () => {
    setRead(new Set(visible.filter((n) => !n.persisted).map((n) => n.id)));
    if (visible.some((n) => n.persisted && !n.readAt)) {
      try {
        await apiRequest("POST", "/api/org-notifications/read-all");
      } catch {
        /* ignore */
      }
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative min-h-[40px] min-w-[40px]"
          data-testid="notification-bell"
          aria-label="Signals"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(100vw-2rem,360px)] p-0" align="end">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="font-semibold text-sm">Signals</p>
          {visible.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={markAllRead}>
              <Check className="h-3 w-3 mr-1" />
              Mark read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-[320px]">
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center">
              You're all caught up. New Signals will appear here.
            </p>
          ) : (
            <ul className="divide-y">
              {visible.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "p-3 text-sm",
                    isUnread(n) && "bg-muted/40",
                  )}
                >
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{n.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                      {n.entityType === "price_guard_manager_check" && n.entityId && (
                        <PriceGuardManagerAnswer checkId={n.entityId} />
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => dismiss(n)}
                      aria-label="Dismiss"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
