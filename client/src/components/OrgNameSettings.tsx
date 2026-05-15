import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";

export function OrgNameSettings() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { selectedOrgId, selectedOrg } = useOrg();
  const canEdit =
    user?.role === "SUPER_ADMIN" || (user?.role === "ADMIN" && user.orgId === selectedOrgId);
  const orgId = user?.role === "SUPER_ADMIN" ? selectedOrgId : user?.orgId;
  const [name, setName] = useState(selectedOrg?.name ?? user?.orgName ?? "");

  useEffect(() => {
    setName(selectedOrg?.name ?? user?.orgName ?? "");
  }, [selectedOrg?.name, user?.orgName]);

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No organization selected");
      await apiRequest("PATCH", `/api/orgs/${orgId}`, { name });
    },
    onSuccess: () => {
      toast({ title: "Organization updated", description: "Business name saved." });
      queryClient.invalidateQueries({ queryKey: ["/api/orgs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  if (!canEdit || !orgId) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Building2 className="h-5 w-5" />
          Organization
        </CardTitle>
        <CardDescription>Business name shown across the app and reports.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="org-display-name">Business / organization name</Label>
          <Input
            id="org-display-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="input-org-display-name"
          />
        </div>
        <Button
          onClick={() => save.mutate()}
          disabled={!name.trim() || save.isPending}
          className="min-h-[44px]"
          data-testid="button-save-org-name"
        >
          Save organization name
        </Button>
      </CardContent>
    </Card>
  );
}
