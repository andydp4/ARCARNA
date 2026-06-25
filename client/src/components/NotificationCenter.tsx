import { useMemo, useState } from "react";
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
import {
  migrateStorageKey,
  STORAGE_NOTIFICATIONS_DISMISSED,
  STORAGE_NOTIFICATIONS_DISMISSED_LEGACY,
} from "@shared/storageKeys";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "error";
  createdAt: string;
  persisted?: boolean;
  readAt?: string | null;
};

function loadDismissed(): Set<string> {
  try {
    const raw = migrateStorageKey(
      STORAGE_NOTIFICATIONS_DISMISSED_LEGACY,
      STORAGE_NOTIFICATIONS_DISMISSED,
    );
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  localStorage.setItem(STORAGE_NOTIFICATIONS_DISMISSED, JSON.stringify([...ids]));
}

export function NotificationCenter() {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());
  const [read, setRead] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);

  const { data } = useQuery<{ items: NotificationItem[] }>({
    queryKey: ["/api/notifications"],
    refetchInterval: 60000,
  });

  const visible = useMemo(() => {
    return (data?.items ?? []).filter((n) => !dismissed.has(n.id));
  }, [data?.items, dismissed]);

  const unreadCount = visible.filter((n) => {
    if (n.readAt) return false;
    if (n.persisted && read.has(n.id)) return false;
    return !read.has(n.id);
  }).length;

  const dismiss = async (id: string, n?: NotificationItem) => {
    if (n?.persisted) {
      try {
        await apiRequest("PATCH", `/api/org-notifications/${id}/read`);
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      } catch {
        /* ignore */
      }
    }
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    saveDismissed(next);
  };

  const markAllRead = () => {
    setRead(new Set(visible.map((n) => n.id)));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative min-h-[40px] min-w-[40px]"
          data-testid="notification-bell"
          aria-label="Notifications"
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
          <p className="font-semibold text-sm">Notifications</p>
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
              You're all caught up. New notifications will appear here.
            </p>
          ) : (
            <ul className="divide-y">
              {visible.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "p-3 text-sm",
                    !read.has(n.id) && !n.readAt && "bg-muted/40",
                  )}
                >
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{n.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => dismiss(n.id, n)}
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
