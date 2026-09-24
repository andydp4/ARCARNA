/**
 * Customer data access (v1.2 Phase 6, PRV-10): the whole org's log of who
 * looked at, or changed, customers' contact details — reveals, the driver's
 * call, replaced numbers, exports, requests and decisions, messages sent
 * without showing the number, and API reads. The owner's page only (Q13a);
 * admins see the same rows one customer at a time ("Access history").
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getJson } from "@/lib/queryClient";
import { ACCESS_ACTIONS, ACCESS_ACTION_LABELS, CONTACT_FIELD_LABELS, type AccessAction, type ContactField } from "@shared/contactAccess";

type Row = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  actorName: string;
  actorRole: string;
  action: string;
  field: string | null;
  createdAt: string;
};

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export default function CustomerAccessLogPage() {
  const [action, setAction] = useState<string>("all");
  const [days, setDays] = useState("30");
  const params = new URLSearchParams({ days, ...(action !== "all" ? { action } : {}) }).toString();
  const { data, isLoading, isError } = useQuery<Row[]>({
    queryKey: ["/api/customer-access-log", params],
    queryFn: () => getJson(`/api/customer-access-log?${params}`),
    staleTime: 0,
    gcTime: 0,
  });

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <PageHeader
        icon={Eye}
        title="Customer data access"
        question="Who has looked at customers' contact details?"
        explanation="Every reveal, driver's call, replaced number, export, request and decision, message sent without showing the number, and API read. Admins see the same, one customer at a time, on the customer's Access history."
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">What</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="w-[240px] min-h-[44px]" data-testid="select-access-action" aria-label="What">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everything</SelectItem>
              {ACCESS_ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {ACCESS_ACTION_LABELS[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Period</Label>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[160px] min-h-[44px]" aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="366">Last year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {isError && <p className="text-sm text-destructive">Could not load the log. Try again.</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && data.length === 0 && <p className="text-sm text-muted-foreground">Nothing in this period.</p>}
      {data && data.length > 0 && (
        <Card className="lm-card border-0 shadow-none">
          <CardContent className="pt-6 overflow-x-auto">
            <Table data-testid="table-customer-access-log">
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Customer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-xs">{when(row.createdAt)}</TableCell>
                    <TableCell className="text-sm">
                      {row.actorName} <span className="text-xs text-muted-foreground">({row.actorRole.toLowerCase().replace("_", " ")})</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{ACCESS_ACTION_LABELS[row.action as AccessAction] ?? row.action}</Badge>
                      {row.field && <span className="ml-2 text-xs">{CONTACT_FIELD_LABELS[row.field as ContactField] ?? row.field}</span>}
                    </TableCell>
                    <TableCell className="text-sm">{row.customerName ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
