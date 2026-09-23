import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "@/contexts/OrgContext";
import { offlineQueueEvents } from "@/lib/offline-storage";
import { syncService } from "@/lib/sync-service";

/**
 * Unsent and refused sales, for the offline indicator, Needs attention and the
 * sign-out guard (v1.2 Phase 1A).
 *
 *   waiting      kept on this till, not yet sent
 *   localFailed  refused, and not yet handed to Needs attention (this till)
 *   serverOpen   on Needs attention for the whole shop, from any till
 *   failed       localFailed + serverOpen — the "1 failed" people see
 */
export function useSaleQueueStatus(): {
  waiting: number;
  localFailed: number;
  serverOpen: number;
  failed: number;
  online: boolean;
} {
  const { selectedOrgId } = useOrg();
  const [local, setLocal] = useState({ waiting: 0, failed: 0 });
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);

  useEffect(() => {
    let cancelled = false;
    const recount = () => {
      void syncService.counts().then((c) => {
        if (!cancelled) setLocal(c);
      });
    };
    const goOnline = () => {
      setOnline(true);
      recount();
    };
    const goOffline = () => setOnline(false);
    recount();
    offlineQueueEvents.addEventListener("change", recount);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // A sale's retry schedule moves without a queue write the page can see
    // (another tab, a sync that found nothing); a slow poll keeps the count honest.
    const timer = window.setInterval(recount, 20_000);
    return () => {
      cancelled = true;
      offlineQueueEvents.removeEventListener("change", recount);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.clearInterval(timer);
    };
  }, [selectedOrgId]);

  const { data } = useQuery<{ open: number }>({
    queryKey: ["/api/sale-issues/summary"],
    enabled: !!selectedOrgId && online,
    refetchInterval: 60_000,
    retry: false,
  });
  const serverOpen = data?.open ?? 0;

  return {
    waiting: local.waiting,
    localFailed: local.failed,
    serverOpen,
    failed: local.failed + serverOpen,
    online,
  };
}
