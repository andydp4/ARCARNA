import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, ArrowRightLeft } from "lucide-react";

type Location = { id: string; name: string };
type Product = { id: string; name: string; productId: string };

type TransferItem = {
  id: string;
  productId: string;
  quantity: number;
  productName?: string;
  sku?: string;
};

type Transfer = {
  id: string;
  fromLocationId: string;
  toLocationId: string;
  status: string;
  notes?: string | null;
  items?: TransferItem[];
  createdAt?: string;
  updatedAt?: string;
};

const NEXT: Record<string, string[]> = {
  draft: ["requested", "cancelled"],
  requested: ["in_transit", "cancelled"],
  in_transit: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  requested: "outline",
  in_transit: "default",
  completed: "default",
  cancelled: "destructive",
};

export function TransfersTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canMutate = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "MANAGER";

  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<Transfer | null>(null);
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [lines, setLines] = useState<{ productId: string; quantity: string }[]>([
    { productId: "", quantity: "1" },
  ]);

  const { data: transfers = [], isLoading } = useQuery<Transfer[]>({
    queryKey: ["/api/inventory/transfers"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const items = lines
        .filter((l) => l.productId && parseInt(l.quantity, 10) > 0)
        .map((l) => ({ productId: l.productId, quantity: parseInt(l.quantity, 10) }));
      return apiRequest("POST", "/api/inventory/transfers", {
        fromLocationId,
        toLocationId,
        items,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/transfers"] });
      setCreateOpen(false);
      toast({ title: "Transfer created" });
    },
    onError: async (e: any) => {
      let msg = "Failed to create transfer";
      try {
        const body = await e?.response?.json?.();
        if (body?.message) msg = body.message;
      } catch {
        /* ignore */
      }
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return apiRequest("PATCH", `/api/inventory/transfers/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/transfers"] });
      setDetail(null);
      toast({ title: "Status updated" });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="space-y-4">
      {!canMutate && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Transfers are read-only for your role. Contact a manager to create or advance transfers.
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Inventory transfers
          </h2>
          <p className="text-sm text-muted-foreground">Stock moves on completion only</p>
        </div>
        {canMutate && (
          <Button onClick={() => setCreateOpen(true)} className="gap-1" data-testid="transfer-create">
            <Plus className="h-4 w-4" />
            New transfer
          </Button>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading transfers…</p>}
      {!isLoading && transfers.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            No transfers yet. Create one to move stock between locations.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:hidden">
        {transfers.map((t) => (
          <Card key={t.id} data-testid={`transfer-card-${t.id}`}>
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start gap-2">
                <CardTitle className="text-base">
                  {locName(t.fromLocationId)} → {locName(t.toLocationId)}
                </CardTitle>
                <Badge variant={statusVariant[t.status] ?? "secondary"}>{t.status}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" className="w-full" onClick={() => setDetail(t)}>
                View details
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="hidden md:block">
        <Card>
          <CardHeader>
            <CardTitle>All transfers</CardTitle>
            <CardDescription>Org-scoped; completion is atomic</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {transfers.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between border rounded-lg p-3"
                data-testid={`transfer-row-${t.id}`}
              >
                <div>
                  <p className="font-medium">
                    {locName(t.fromLocationId)} → {locName(t.toLocationId)}
                  </p>
                  <p className="text-xs text-muted-foreground">{t.items?.length ?? 0} line(s)</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant[t.status] ?? "secondary"}>{t.status}</Badge>
                  <Button variant="outline" size="sm" onClick={() => setDetail(t)}>
                    Details
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create transfer</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>From location</Label>
              <Select value={fromLocationId} onValueChange={setFromLocationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>To location</Label>
              <Select value={toLocationId} onValueChange={setToLocationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select destination" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Product</Label>
                  <Select
                    value={line.productId}
                    onValueChange={(v) => {
                      const next = [...lines];
                      next[idx] = { ...next[idx], productId: v };
                      setLines(next);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Product" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Qty</Label>
                  <Input
                    type="number"
                    min={1}
                    value={line.quantity}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...next[idx], quantity: e.target.value };
                      setLines(next);
                    }}
                  />
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines([...lines, { productId: "", quantity: "1" }])}
            >
              Add line
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={
                !fromLocationId ||
                !toLocationId ||
                fromLocationId === toLocationId ||
                createMutation.isPending
              }
            >
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer details</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <p>
                <span className="text-muted-foreground">Route:</span> {locName(detail.fromLocationId)} →{" "}
                {locName(detail.toLocationId)}
              </p>
              <Badge variant={statusVariant[detail.status] ?? "secondary"}>{detail.status}</Badge>
              <ul className="border rounded divide-y">
                {(detail.items ?? []).map((item) => (
                  <li key={item.id} className="p-2 flex justify-between">
                    <span>{item.productName ?? item.productId}</span>
                    <span>×{item.quantity}</span>
                  </li>
                ))}
              </ul>
              {canMutate && (NEXT[detail.status] ?? []).length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {(NEXT[detail.status] ?? []).map((next) => (
                    <Button
                      key={next}
                      size="sm"
                      variant={next === "cancelled" ? "destructive" : "default"}
                      onClick={() => statusMutation.mutate({ id: detail.id, status: next })}
                      disabled={statusMutation.isPending}
                    >
                      → {next.replace("_", " ")}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
