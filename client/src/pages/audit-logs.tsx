import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { resolveApiUrl } from "@/lib/appPaths";

type AuditRow = {
  id: string;
  orgId: string | null;
  actorUserId: string;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

export default function AuditLogsPage() {
  const { user } = useAuth();
  const { data = [], isLoading, error } = useQuery<AuditRow[]>({
    queryKey: ["/api/admin/audit-logs"],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl("/api/admin/audit-logs?limit=200"), {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        throw new Error(body.message || body.code || "Forbidden");
      }
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: user?.role === "SUPER_ADMIN",
  });

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="p-6">
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Restricted</AlertTitle>
          <AlertDescription>Audit log is only available to super administrators.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const needsMfa =
    user?.runtime?.authProvider === "clerk" && user.clerkTwoFactorEnabled === false;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security audit log</h1>
        <p className="text-muted-foreground text-sm mt-1">
          High-privilege actions (access control, org creation, super-admin tooling). See docs/SECURITY_REVIEW.md.
        </p>
      </div>

      {needsMfa && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Two-factor authentication required</AlertTitle>
          <AlertDescription>
            Enable MFA on your Clerk account to use worker logs, audit export, and other super-admin APIs.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent events</CardTitle>
          <CardDescription>Latest 200 entries (newest first)</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && (
            <p className="text-sm text-destructive">
              {(error as Error).message || "Failed to load audit log"}
            </p>
          )}
          {!isLoading && !error && (
            <ScrollArea className="h-[min(70vh,640px)] w-full rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground text-sm">
                        No entries yet. Approve a user or create an organization to generate audit events.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-xs font-mono">
                          {row.createdAt
                            ? format(new Date(row.createdAt), "yyyy-MM-dd HH:mm:ss")
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{row.action}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div>{row.actorRole || "—"}</div>
                          <div className="text-muted-foreground truncate max-w-[200px]" title={row.actorUserId}>
                            {row.actorUserId}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.targetType && (
                            <div>
                              {row.targetType}:{" "}
                              <span className="font-mono break-all">{row.targetId || "—"}</span>
                            </div>
                          )}
                          {!row.targetType && "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono">{row.ipAddress || "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
