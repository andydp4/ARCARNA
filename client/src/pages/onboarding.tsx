import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Building2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { setSelectedOrgId } from "@/lib/orgScope";

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user, devAuthBypass } = useAuth();
  const [orgName, setOrgName] = useState("");

  const createOrg = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/orgs", { name });
      return res.json();
    },
    onSuccess: (org: { id: string }) => {
      setSelectedOrgId(org.id);
      queryClient.invalidateQueries({ queryKey: ["/api/orgs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/onboarding/wizard");
    },
  });

  useEffect(() => {
    if (user && user.role !== "SUPER_ADMIN") {
      setLocation("/no-access");
    }
  }, [user, setLocation]);

  if (user && user.role !== "SUPER_ADMIN") {
    return null;
  }

  return (
    <div className="min-h-screen lm-auth-shell liquid-metal flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Building2 className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Set up your business</CardTitle>
          <CardDescription>
            Create your first organization to start using Midnight EPOS.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {devAuthBypass && (
            <p className="text-xs text-center text-amber-950 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-100 rounded-md p-2">
              Dev auth bypass is active (DEV_AUTH_BYPASS=1).
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="org-name">Business / organization name</Label>
            <Input
              id="org-name"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="e.g. Midnight Retail Ltd"
              data-testid="input-org-name"
            />
          </div>
          <Button
            className="w-full min-h-[44px]"
            disabled={!orgName.trim() || createOrg.isPending}
            onClick={() => createOrg.mutate(orgName.trim())}
            data-testid="button-create-org"
          >
            Create organization
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
