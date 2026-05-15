import { Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";

function OrgLabel({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 text-sm max-w-[200px]" data-testid="org-label">
      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{name}</span>
    </div>
  );
}

export function OrgSwitcher() {
  const { user } = useAuth();
  const { organizations, selectedOrgId, setSelectedOrgId, canSwitchOrgs, selectedOrg } = useOrg();

  if (!user) return null;

  if (user.role !== "SUPER_ADMIN") {
    return <OrgLabel name={user.orgName ?? selectedOrg?.name ?? "No organization"} />;
  }

  if (!canSwitchOrgs && organizations.length === 0) {
    return <Badge variant="outline">No organizations yet</Badge>;
  }

  if (organizations.length === 1) {
    return <OrgLabel name={organizations[0].name} />;
  }

  return (
    <Select
      value={selectedOrgId ?? ""}
      onValueChange={(v) => setSelectedOrgId(v || null)}
    >
      <SelectTrigger className="h-9 w-[200px] max-w-[45vw]" data-testid="org-switcher">
        <Building2 className="mr-2 h-4 w-4 shrink-0 opacity-70" />
        <SelectValue placeholder="Select organization" />
      </SelectTrigger>
      <SelectContent>
        {organizations.map((org) => (
          <SelectItem key={org.id} value={org.id} data-testid={`org-option-${org.id}`}>
            {org.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
