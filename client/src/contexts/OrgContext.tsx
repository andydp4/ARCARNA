import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSelectedOrgId, setSelectedOrgId } from "@/lib/orgScope";
import { useAuth, type AuthUser } from "@/hooks/useAuth";
import {
  LEGACY_OFFLINE_DB_NAME,
  offlineStorage,
} from "@/lib/offline-storage";
import {
  deleteIndexedDb,
  wipeAllOfflineData,
  wipeOrgOfflineData,
} from "@/lib/orgCacheWipe";

export interface Organization {
  id: string;
  name: string;
}

interface OrgContextValue {
  organizations: Organization[];
  selectedOrgId: string | null;
  selectedOrg: Organization | null;
  setSelectedOrgId: (orgId: string | null) => void;
  isLoading: boolean;
  canSwitchOrgs: boolean;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function shouldWipeOfflineDataForAuthState({
  user,
  isLoading,
  error,
}: {
  user: AuthUser | null;
  isLoading: boolean;
  error: unknown;
}): boolean {
  return !isLoading && !error && !user;
}

function resolveSelectedOrg(
  user: AuthUser | null | undefined,
  orgs: Organization[],
): string | null {
  if (!user) return null;
  if (user.role === "SUPER_ADMIN") {
    const stored = getSelectedOrgId();
    if (stored && orgs.some((o) => o.id === stored)) return stored;
    if (orgs.length > 0) return orgs[0].id;
    return null;
  }
  return user.orgId ?? null;
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const {
    user,
    isAuthenticated,
    isLoading: authLoading,
    error: authError,
  } = useAuth();
  const { data: orgs = [], isLoading } = useQuery<Organization[]>({
    queryKey: ["/api/orgs"],
    enabled: isAuthenticated && !!user,
  });

  const [selectedOrgId, setSelectedOrgIdState] = useState<string | null>(null);
  const prevOrgIdRef = useRef<string | null>(null);
  const shouldWipeOfflineData = shouldWipeOfflineDataForAuthState({
    user,
    isLoading: authLoading,
    error: authError,
  });

  useEffect(() => {
    if (shouldWipeOfflineData) {
      setSelectedOrgIdState(null);
      prevOrgIdRef.current = null;
      offlineStorage.setActiveOrg(null);
      void wipeAllOfflineData();
      return;
    }
    if (!user) return;
    void deleteIndexedDb(LEGACY_OFFLINE_DB_NAME);
  }, [shouldWipeOfflineData, user]);

  useEffect(() => {
    if (!user) return;
    const next = resolveSelectedOrg(user, orgs);
    setSelectedOrgIdState(next);
    if (user.role === "SUPER_ADMIN" && next) setSelectedOrgId(next);
    else if (user.role !== "SUPER_ADMIN" && user.orgId) setSelectedOrgId(user.orgId);
  }, [user, orgs]);

  useEffect(() => {
    const prev = prevOrgIdRef.current;
    if (prev && selectedOrgId && prev !== selectedOrgId) {
      void wipeOrgOfflineData(prev);
    }
    prevOrgIdRef.current = selectedOrgId;
    offlineStorage.setActiveOrg(selectedOrgId);
  }, [selectedOrgId]);

  const setSelectedOrgIdHandler = useCallback(
    (orgId: string | null) => {
      setSelectedOrgIdState(orgId);
      setSelectedOrgId(orgId);
      queryClient.invalidateQueries();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/org/setup"] });
    },
    [queryClient],
  );

  const selectedOrg = useMemo(
    () => orgs.find((o) => o.id === selectedOrgId) ?? null,
    [orgs, selectedOrgId],
  );

  const value = useMemo<OrgContextValue>(
    () => ({
      organizations: orgs,
      selectedOrgId,
      selectedOrg,
      setSelectedOrgId: setSelectedOrgIdHandler,
      isLoading,
      canSwitchOrgs: user?.role === "SUPER_ADMIN" && orgs.length > 0,
    }),
    [orgs, selectedOrgId, selectedOrg, setSelectedOrgIdHandler, isLoading, user?.role],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within OrgProvider");
  return ctx;
}
