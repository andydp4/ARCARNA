import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/Skeleton";
import { Radio } from "lucide-react";
import type { ChannelAttributionRow } from "@shared/analytics/channelAttribution";

type ChannelResponse = {
  channels: ChannelAttributionRow[];
  days: number;
};

const CHANNEL_LABELS: Record<string, string> = {
  pos: "In-store POS",
  web: "Web",
  api: "API",
  whatsapp: "WhatsApp",
  phone: "Phone",
};

function labelFor(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel.charAt(0).toUpperCase() + channel.slice(1);
}

export default function ChannelAttributionPage() {
  const { data, isLoading } = useQuery<ChannelResponse>({
    queryKey: ["/api/analytics/channels"],
    queryFn: async () => {
      const res = await apiFetch("/api/analytics/channels?days=90", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load channel attribution");
      return res.json();
    },
  });

  const totalRevenue = (data?.channels ?? []).reduce((s, r) => s + r.revenue, 0);

  return (
    <div className="container mx-auto space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Radio className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Channel attribution</h1>
          <p className="text-sm text-muted-foreground">
            Completed order revenue by sales channel (last {data?.days ?? 90} days).
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue by channel</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (data?.channels.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No completed orders in this window.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">AOV</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.channels.map((row) => (
                  <TableRow key={row.channel}>
                    <TableCell className="font-medium">{labelFor(row.channel)}</TableCell>
                    <TableCell className="text-right">{row.orderCount}</TableCell>
                    <TableCell className="text-right">£{row.revenue.toFixed(2)}</TableCell>
                    <TableCell className="text-right">£{row.aov.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{row.sharePct}%</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">
                    {(data?.channels ?? []).reduce((s, r) => s + r.orderCount, 0)}
                  </TableCell>
                  <TableCell className="text-right">£{totalRevenue.toFixed(2)}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
