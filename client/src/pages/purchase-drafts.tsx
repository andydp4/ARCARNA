import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Download, Trash2, PackageCheck } from "lucide-react";
import { Link } from "wouter";
import { Label } from "@/components/ui/label";
import { DialogDescription } from "@/components/ui/dialog";

type DraftListItem = {
  id: string;
  supplierName: string;
  locationName: string;
  status: string;
  lineCount: number;
  totalQty: number;
  updatedAt?: string;
};

type DraftDetail = DraftListItem & {
  items: {
    id: string;
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    quantityReceived?: number;
    estimatedCost?: string | null;
    supplierSku?: string | null;
  }[];
};

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  reviewed: "outline",
  approved: "default",
  partially_received: "outline",
  fully_received: "default",
  cancelled: "destructive",
};

const NEXT_STATUS: Record<string, string[]> = {
  draft: ["reviewed", "cancelled"],
  reviewed: ["approved", "cancelled"],
  approved: ["cancelled"],
  partially_received: ["cancelled"],
  fully_received: [],
  cancelled: [],
};

const STATUS_HELP: Record<string, string> = {
  draft: "Internal only — not sent to supplier.",
  reviewed: "Ready for manager approval.",
  approved: "Approved internally — stock increases only via goods receiving.",
  partially_received: "Some lines received — complete remaining receipts.",
  fully_received: "All ordered quantity received — read-only.",
  cancelled: "Cancelled — cannot receive against this draft.",
};

export default function PurchaseDraftsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canMutate =
    user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "MANAGER";

  const [detailId, setDetailId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState<Record<string, string>>({});
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveQty, setReceiveQty] = useState<Record<string, { received: string; damaged: string }>>({});

  const { data: drafts = [], isLoading } = useQuery<DraftListItem[]>({
    queryKey: ["/api/purchase-drafts"],
  });

  const { data: detail } = useQuery<DraftDetail>({
    queryKey: detailId ? [`/api/purchase-drafts/${detailId}`] : ["skip"],
    enabled: !!detailId,
  });

  const { data: receiving } = useQuery<{
    items: {
      id: string;
      productId: string;
      productName: string;
      sku: string;
      quantity: number;
      alreadyReceived: number;
      remaining: number;
    }[];
    receipts: { id: string; status: string; createdAt?: string }[];
  }>({
    queryKey: detailId ? [`/api/purchase-drafts/${detailId}/receiving`] : ["skip"],
    enabled: !!detailId,
  });

  const createReceipt = useMutation({
    mutationFn: async () => {
      if (!detailId) return;
      const items = (receiving?.items ?? [])
        .map((item) => {
          const q = receiveQty[item.id];
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
        purchaseDraftId: detailId,
        items,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goods-receipts"] });
      if (detailId) {
        queryClient.invalidateQueries({ queryKey: [`/api/purchase-drafts/${detailId}/receiving`] });
        queryClient.invalidateQueries({ queryKey: [`/api/purchase-drafts/${detailId}`] });
      }
      setReceiveOpen(false);
      toast({ title: "Pending receipt created — complete it in Receiving" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/purchase-drafts/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-drafts"] });
      if (detailId) queryClient.invalidateQueries({ queryKey: [`/api/purchase-drafts/${detailId}`] });
      toast({ title: "Status updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/purchase-drafts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-drafts"] });
      setDetailId(null);
      toast({ title: "Draft deleted" });
    },
  });

  const updateLine = useMutation({
    mutationFn: ({ draftId, itemId, quantity }: { draftId: string; itemId: string; quantity: number }) =>
      apiRequest("PATCH", `/api/purchase-drafts/${draftId}/items/${itemId}`, { quantity }),
    onSuccess: () => {
      if (detailId) queryClient.invalidateQueries({ queryKey: [`/api/purchase-drafts/${detailId}`] });
      toast({ title: "Line updated" });
    },
  });

  const exportCsv = (d: DraftDetail) => {
    const header = "SKU,Product,Qty,Est cost,Supplier SKU\n";
    const rows = d.items
      .map(
        (i) =>
          `${i.sku},"${i.productName}",${i.quantity},${i.estimatedCost ?? ""},${i.supplierSku ?? ""}`,
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchase-draft-${d.id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Purchase drafts</h1>
          <p className="text-muted-foreground text-sm">
            Internal workflow only — not sent to suppliers or paid. Stock increases only when a goods receipt is completed.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Drafts</CardTitle>
            <CardDescription>Created from replenishment recommendations or manually</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Lines</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.supplierName}</TableCell>
                    <TableCell>{d.locationName}</TableCell>
                    <TableCell>
                      {d.lineCount} lines / {d.totalQty} units
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[d.status] ?? "outline"}>{d.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" onClick={() => setDetailId(d.id)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={!!detailId} onOpenChange={() => setDetailId(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Purchase draft</DialogTitle>
              {detail && (
                <CardDescription>
                  {detail.supplierName} → {detail.locationName}
                </CardDescription>
              )}
            </DialogHeader>
            {detail && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant[detail.status] ?? "outline"}>{detail.status}</Badge>
                  {canMutate &&
                    (NEXT_STATUS[detail.status] ?? []).map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant="outline"
                        onClick={() => statusMutation.mutate({ id: detail.id, status: s })}
                      >
                        Mark {s}
                      </Button>
                    ))}
                  <Button size="sm" variant="ghost" onClick={() => exportCsv(detail)}>
                    <Download className="h-4 w-4 mr-1" />
                    CSV
                  </Button>
                  {canMutate &&
                    (detail.status === "approved" || detail.status === "partially_received") && (
                      <Button size="sm" onClick={() => setReceiveOpen(true)}>
                        <PackageCheck className="h-4 w-4 mr-1" />
                        Receive goods
                      </Button>
                    )}
                  <Button size="sm" variant="ghost" asChild>
                    <Link href="/inventory">Receiving tab</Link>
                  </Button>
                  {canMutate && detail.status !== "cancelled" && detail.status !== "fully_received" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(detail.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{STATUS_HELP[detail.status]}</p>
                {receiving && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      {receiving.receipts.filter((r) => r.status === "pending").length} pending receipt(s)
                      ·{" "}
                      {receiving.items.reduce((s, i) => s + i.alreadyReceived, 0)} /{" "}
                      {receiving.items.reduce((s, i) => s + i.quantity, 0)} units received
                    </p>
                    {receiving.receipts.length > 0 && (
                      <ul className="text-sm space-y-1 border rounded p-2">
                        <li className="font-medium text-xs uppercase text-muted-foreground">
                          Receiving history
                        </li>
                        {receiving.receipts.map((r) => (
                          <li key={r.id} className="flex justify-between gap-2">
                            <span>
                              {r.status} · {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
                            </span>
                            <Link
                              href="/inventory"
                              className="text-primary underline text-xs"
                              title="Open Inventory → Receiving tab and view receipt detail"
                            >
                              Receipt {r.id.slice(0, 8)}…
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Ordered</TableHead>
                      <TableHead>Received</TableHead>
                      <TableHead>Remaining</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.map((line) => {
                      const rec = receiving?.items.find((i) => i.id === line.id);
                      return (
                        <TableRow key={line.id}>
                          <TableCell>{line.productName}</TableCell>
                          <TableCell>{line.sku}</TableCell>
                          <TableCell>
                            {canMutate && detail.status === "draft" ? (
                              <div className="flex gap-2 items-center">
                                <Input
                                  className="w-20"
                                  value={editQty[line.id] ?? String(line.quantity)}
                                  onChange={(e) =>
                                    setEditQty({ ...editQty, [line.id]: e.target.value })
                                  }
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    updateLine.mutate({
                                      draftId: detail.id,
                                      itemId: line.id,
                                      quantity: parseInt(
                                        editQty[line.id] ?? String(line.quantity),
                                        10,
                                      ),
                                    })
                                  }
                                >
                                  Save
                                </Button>
                              </div>
                            ) : (
                              line.quantity
                            )}
                          </TableCell>
                          <TableCell>{line.quantityReceived ?? rec?.alreadyReceived ?? 0}</TableCell>
                          <TableCell>
                            {rec?.remaining ?? line.quantity - (line.quantityReceived ?? 0)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground">
                  Approving does not send to supplier. Complete a goods receipt to increase stock.
                </p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDetailId(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Receive goods</DialogTitle>
              <DialogDescription>
                Creates a pending receipt. Stock increases only when the receipt is completed.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {receiving?.items.map((item) => (
                <div key={item.id} className="border rounded p-3 space-y-2">
                  <p className="font-medium text-sm">
                    {item.productName} — remaining {item.remaining}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Qty received</Label>
                      <Input
                        type="number"
                        min={0}
                        max={item.remaining}
                        value={receiveQty[item.id]?.received ?? ""}
                        onChange={(e) =>
                          setReceiveQty({
                            ...receiveQty,
                            [item.id]: {
                              received: e.target.value,
                              damaged: receiveQty[item.id]?.damaged ?? "0",
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
                        value={receiveQty[item.id]?.damaged ?? "0"}
                        onChange={(e) =>
                          setReceiveQty({
                            ...receiveQty,
                            [item.id]: {
                              received: receiveQty[item.id]?.received ?? "",
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
              <Button onClick={() => createReceipt.mutate()} disabled={createReceipt.isPending}>
                Create pending receipt
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}
