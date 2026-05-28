import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Flag } from "lucide-react";

type FlagRow = {
  flag: string;
  label: string;
  description: string;
  enabled: boolean;
  known: boolean;
};

type FeatureFlagsResponse = { flags: FlagRow[] };

export function FeatureFlagsSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<FeatureFlagsResponse>({
    queryKey: ["/api/feature-flags"],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 60_000,
  });

  const toggle = useMutation({
    mutationFn: async ({ flag, enabled }: { flag: string; enabled: boolean }) => {
      await apiRequest("PUT", `/api/feature-flags/${encodeURIComponent(flag)}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feature-flags"] });
      toast({ title: "Feature flag updated" });
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  const flags = data?.flags ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Flag className="h-5 w-5" />
          Feature flags
        </CardTitle>
        <CardDescription>
          Per-organization toggles for in-progress features. Changes apply within about 60 seconds
          on connected clients.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading flags…</p>}
        {!isLoading && flags.length === 0 && (
          <p className="text-sm text-muted-foreground">No flags configured.</p>
        )}
        {flags.map((row) => (
          <div
            key={row.flag}
            className="flex items-start justify-between gap-4 rounded-lg border p-4"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{row.label}</span>
                <Badge variant="outline" className="font-mono text-xs">
                  {row.flag}
                </Badge>
                {!row.known && <Badge variant="secondary">unknown</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{row.description}</p>
            </div>
            <Switch
              checked={row.enabled}
              disabled={!row.known || toggle.isPending}
              onCheckedChange={(enabled) => toggle.mutate({ flag: row.flag, enabled })}
              aria-label={`Toggle ${row.label}`}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
