import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { getSelectedOrgId } from "@/lib/orgScope";
import {
  cachedEnabled,
  cachedManagers,
  lastReason,
  rememberEnabled,
  rememberManagers,
  rememberReason,
  type GuardChoice,
  type GuardManager,
} from "@/lib/priceGuard";
import type { PriceGuardReason } from "@shared/pricing/priceGuard";

/**
 * The till's price guard state (v1.2 Phase 4). The switch comes with the
 * org's settings the till already reads; it and the managers list are kept on
 * the device, so a till that loses its connection still checks against the
 * cached floor and can still name a manager.
 */
export function usePriceGuard(settingsEnabled: boolean | undefined) {
  const { user } = useAuth();
  const orgKey = (user as { orgId?: string | null } | null)?.orgId ?? getSelectedOrgId() ?? "default";
  const userKey = (user as { id?: string } | null)?.id ?? "anon";

  useEffect(() => {
    if (typeof settingsEnabled === "boolean") rememberEnabled(orgKey, settingsEnabled);
  }, [orgKey, settingsEnabled]);
  const enabled = typeof settingsEnabled === "boolean" ? settingsEnabled : cachedEnabled(orgKey);

  const { data: fetched } = useQuery<GuardManager[]>({
    queryKey: ["/api/price-guard/managers"],
    enabled,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (Array.isArray(fetched)) rememberManagers(orgKey, fetched);
  }, [orgKey, fetched]);
  const managers = useMemo(
    () => (Array.isArray(fetched) ? fetched : cachedManagers(orgKey)).filter((m) => m.id !== userKey),
    [fetched, orgKey, userKey],
  );

  const [choice, setChoice] = useState<GuardChoice>(() => ({
    reason: lastReason(userKey),
    note: "",
    managerUserId: "",
  }));
  // A different person on the till gets their own last reason.
  useEffect(() => {
    setChoice({ reason: lastReason(userKey), note: "", managerUserId: "" });
  }, [userKey]);

  return {
    enabled,
    managers,
    choice,
    setChoice,
    /** After a sale goes (or queues): keep the reason, clear what was particular to it. */
    afterSale(reason: PriceGuardReason) {
      rememberReason(userKey, reason);
      setChoice({ reason, note: "", managerUserId: "" });
    },
  };
}
