import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSelectedOrgId, setSelectedOrgId } from "@/lib/orgScope";
import { useAuth, type AuthUser } from "@/hooks/useAuth";

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
  const { user, isAuthenticated } = useAuth();
  const { data: orgs = [], isLoading } = useQuery<Organization[]>({
    queryKey: ["/api/orgs"],
    enabled: isAuthenticated && !!user,
  });

  const [selectedOrgId, setSelectedOrgIdState] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setSelectedOrgIdState(null);
      return;
    }
    const next = resolveSelectedOrg(user, orgs);
    setSelectedOrgIdState(next);
    if (user.role === "SUPER_ADMIN" && next) setSelectedOrgId(next);
    else if (user.role !== "SUPER_ADMIN" && user.orgId) setSelectedOrgId(user.orgId);
  }, [user, orgs]);

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
