import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Layout } from "@/components/Layout";
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
import { Download, Trash2 } from "lucide-react";

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
    estimatedCost?: string | null;
    supplierSku?: string | null;
  }[];
};

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  reviewed: "outline",
  approved: "default",
  cancelled: "destructive",
};

const NEXT_STATUS: Record<string, string[]> = {
  draft: ["reviewed", "cancelled"],
  reviewed: ["approved", "cancelled"],
  approved: ["cancelled"],
  cancelled: [],
};

export default function PurchaseDraftsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canMutate =
    user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "MANAGER";

  const [detailId, setDetailId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState<Record<string, string>>({});

  const { data: drafts = [], isLoading } = useQuery<DraftListItem[]>({
    queryKey: ["/api/purchase-drafts"],
  });

  const { data: detail } = useQuery<DraftDetail>({
    queryKey: detailId ? [`/api/purchase-drafts/${detailId}`] : ["skip"],
    enabled: !!detailId,
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
    <Layout>
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Purchase drafts</h1>
          <p className="text-muted-foreground text-sm">
            Internal workflow only — not sent to suppliers, no payment, no stock receipt.
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
                  {canMutate && detail.status !== "cancelled" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(detail.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.map((line) => (
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
                                    quantity: parseInt(editQty[line.id] ?? String(line.quantity), 10),
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground">
                  Approving this draft does not send an order to the supplier or book stock in.
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
      </div>
    </Layout>
  );
}
