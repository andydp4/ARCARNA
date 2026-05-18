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
  DialogDescription,
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
import { Link } from "wouter";
import { PackageCheck, Eye } from "lucide-react";

type ReceiptListItem = {
  id: string;
  purchaseDraftId: string;
  locationName: string;
  status: string;
  supplierReference?: string | null;
  receivedBy?: string | null;
  receivedAt?: string | null;
  createdAt?: string;
};

type ReceiptDetail = ReceiptListItem & {
  purchaseDraftId: string;
  supplierName: string;
  deliveryNote?: string | null;
  items: {
    id: string;
    productName: string;
    sku: string;
    quantityReceived: number;
    quantityDamaged: number;
    notes?: string | null;
  }[];
};

type DraftOption = {
  id: string;
  supplierName: string;
  locationName: string;
  status: string;
};

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  completed: "default",
  voided: "destructive",
};

export function ReceivingTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canMutate =
    user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "MANAGER";

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [completeTarget, setCompleteTarget] = useState<ReceiptDetail | null>(null);
  const [createDraftId, setCreateDraftId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [lineQty, setLineQty] = useState<Record<string, { received: string; damaged: string }>>({});

  const queryKey =
    statusFilter === "all"
      ? "/api/goods-receipts"
      : `/api/goods-receipts?status=${statusFilter}`;

  const { data: receipts = [], isLoading } = useQuery<ReceiptListItem[]>({
    queryKey: [queryKey],
  });

  const { data: detail } = useQuery<ReceiptDetail>({
    queryKey: detailId ? [`/api/goods-receipts/${detailId}`] : ["skip"],
    enabled: !!detailId,
  });

  const { data: receivableDrafts = [] } = useQuery<DraftOption[]>({
    queryKey: ["/api/purchase-drafts"],
    select: (rows: DraftOption[]) =>
      rows.filter((d) => d.status === "approved" || d.status === "partially_received"),
  });

  const { data: receivingInfo } = useQuery<{
    items: {
      id: string;
      productId: string;
      productName: string;
      sku: string;
      quantity: number;
      alreadyReceived: number;
      remaining: number;
    }[];
  }>({
    queryKey: createDraftId ? [`/api/purchase-drafts/${createDraftId}/receiving`] : ["skip"],
    enabled: !!createDraftId && createOpen,
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/goods-receipts/${id}/complete`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goods-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setCompleteTarget(null);
      setDetailId(null);
      toast({
        title: "Receipt completed",
        description: "Stock has been increased at the receiving location.",
      });
    },
    onError: (e: Error) => toast({ title: "Completion failed", description: e.message, variant: "destructive" }),
  });

  const voidMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/goods-receipts/${id}/void`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goods-receipts"] });
      setDetailId(null);
      toast({ title: "Receipt voided" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const items = (receivingInfo?.items ?? [])
        .map((item) => {
          const q = lineQty[item.id];
          const received = parseInt(q?.received ?? "0", 10);
          const damaged = parseInt(q?.damaged ?? "0", 10);
          if (received <= 0) return null;
          return {
            purchaseDraftItemId: item.id,
            productId: item.productId,
            quantityReceived: received,
            quantityDamaged: damaged || 0,
          };
        })
        .filter(Boolean);
      return apiRequest("POST", "/api/goods-receipts", {
        purchaseDraftId: createDraftId,
        items,
      });
    },
    onSuccess: async (res: Response) => {
      const body = (await res.json()) as { id: string };
      queryClient.invalidateQueries({ queryKey: ["/api/goods-receipts"] });
      setCreateOpen(false);
      setCreateDraftId("");
      toast({ title: "Pending receipt created", description: `Receipt ${body.id.slice(0, 8)}…` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 justify-between items-center">
        <div className="flex gap-2 items-center">
          <Label className="sr-only">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="voided">Voided</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canMutate && (
          <Button
            onClick={() => {
              setCreateOpen(true);
              setLineQty({});
            }}
          >
            <PackageCheck className="h-4 w-4 mr-1" />
            New receipt
          </Button>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading receipts…</p>}

      <div className="grid gap-3 md:grid-cols-2">
        {receipts.map((r) => (
          <Card key={r.id}>
            <CardHeader className="pb-2">
              <div className="flex justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{r.locationName}</CardTitle>
                  <CardDescription>
                    Draft {r.purchaseDraftId.slice(0, 8)}… ·{" "}
                    {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
                  </CardDescription>
                </div>
                <Badge variant={statusVariant[r.status] ?? "outline"}>{r.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDetailId(r.id)}>
                <Eye className="h-4 w-4 mr-1" />
                Detail
              </Button>
              {canMutate && r.status === "pending" && (
                <Button variant="default" size="sm" onClick={() => setDetailId(r.id)}>
                  Complete
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!detailId} onOpenChange={() => setDetailId(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Goods receipt</DialogTitle>
            {detail && (
              <CardDescription>
                {detail.supplierName} · {detail.locationName}
              </CardDescription>
            )}
          </DialogHeader>
            {detail && (
            <div className="space-y-4 text-sm">
              <Badge variant={statusVariant[detail.status] ?? "outline"}>{detail.status}</Badge>
              <p>
                Purchase draft:{" "}
                <Link href="/purchase-drafts" className="text-primary underline">
                  {detail.purchaseDraftId.slice(0, 8)}… (view drafts)
                </Link>
              </p>
              <p className="text-xs text-muted-foreground">
                Stock increases only when this receipt is completed. Approval does not send orders or
                payment.
              </p>
              {detail.receivedAt && (
                <p>
                  Received {new Date(detail.receivedAt).toLocaleString()}
                  {detail.receivedBy ? ` by ${detail.receivedBy}` : ""}
                </p>
              )}
              <ul className="space-y-2">
                {detail.items.map((line) => (
                  <li key={line.id} className="border rounded p-2">
                    <strong>{line.productName}</strong> ({line.sku})<br />
                    Good: {line.quantityReceived} · Damaged: {line.quantityDamaged}
                  </li>
                ))}
              </ul>
              {canMutate && detail.status === "pending" && (
                <div className="flex gap-2">
                  <Button variant="destructive" size="sm" onClick={() => voidMutation.mutate(detail.id)}>
                    Void
                  </Button>
                  <Button size="sm" onClick={() => setCompleteTarget(detail)}>
                    Complete receipt
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!completeTarget} onOpenChange={() => setCompleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete goods receipt?</DialogTitle>
            <DialogDescription>
              Completing this receipt will increase stock at the receiving location. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => completeTarget && completeMutation.mutate(completeTarget.id)}
              disabled={completeMutation.isPending}
            >
              Complete receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create pending receipt</DialogTitle>
            <DialogDescription>
              Select an approved purchase draft and enter quantities to receive.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Purchase draft</Label>
              <Select
                value={createDraftId}
                onValueChange={(v) => {
                  setCreateDraftId(v);
                  setLineQty({});
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select draft" />
                </SelectTrigger>
                <SelectContent>
                  {receivableDrafts.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.supplierName} · {d.locationName} ({d.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {receivingInfo?.items.map((item) => (
              <div key={item.id} className="border rounded p-3 space-y-2">
                <p className="font-medium text-sm">
                  {item.productName} ({item.sku})
                </p>
                <p className="text-xs text-muted-foreground">
                  Ordered {item.quantity} · Received {item.alreadyReceived} · Remaining{" "}
                  {item.remaining}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Qty received</Label>
                    <Input
                      type="number"
                      min={0}
                      max={item.remaining}
                      value={lineQty[item.id]?.received ?? ""}
                      onChange={(e) =>
                        setLineQty({
                          ...lineQty,
                          [item.id]: {
                            received: e.target.value,
                            damaged: lineQty[item.id]?.damaged ?? "0",
                          },
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Damaged</Label>
                    <Input
                      type="number"
                      min={0}
                      value={lineQty[item.id]?.damaged ?? "0"}
                      onChange={(e) =>
                        setLineQty({
                          ...lineQty,
                          [item.id]: {
                            received: lineQty[item.id]?.received ?? "",
                            damaged: e.target.value,
                          },
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!createDraftId || createMutation.isPending}
            >
              Create pending receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
