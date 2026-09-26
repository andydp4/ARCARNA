import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/appPaths";
import { formatUkPhone } from "@shared/customerView";

/**
 * The board's phone search, on the server (v1.2 Phase 5, PRV-04). The board
 * carries no phone, so a whole UK number typed into its search box is sent to
 * POST /api/orders/board/phone-search, which answers with the ids of the
 * matching orders. Anything that is not a whole number searches nothing here:
 * there are no partial matches. Kept in component state, never cached.
 */
export function useBoardPhoneSearch(search: string): Set<string> | null {
  const formatted = formatUkPhone(search);
  const [hits, setHits] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!formatted) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch("/api/orders/board/phone-search", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: formatted }),
        });
        const body = res.ok ? await res.json() : { orderIds: [] };
        if (!cancelled) setHits(new Set<string>(body.orderIds ?? []));
      } catch {
        if (!cancelled) setHits(new Set());
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [formatted]);

  return formatted ? hits ?? new Set() : null;
}
