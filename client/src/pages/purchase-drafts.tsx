import { csvDocument } from "@shared/csv";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { invalidatePurchasingPipeline } from "@/lib/query-invalidation";
import { clearQueryParams, readQueryParam, receiptLink, withQuery } from "@/lib/deepLink";
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
import { Download, Trash2, PackageCheck, FileText } from "lucide-react";
import { Link } from "wouter";
import { Label } from "@/components/ui/label";
import { DialogDescription } from "@/components/ui/dialog";
import { parseNonNegativeQuantityInput, parseQuantityInput } from "@shared/quantity";
import { resolvePurchaseUnitCost } from "@shared/purchasing/purchaseLines";
import { OverDeliveryConfirm, overDeliveryState } from "@/components/inventory/OverDeliveryConfirm";
import { pendingLineChange, type SavedLine } from "@/lib/purchaseDraftEdits";

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
  sourceRecommendationJson?: SourceRecommendationJson | null;
  items: {
    id: string;
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    quantityReceived?: number;
    estimatedCost?: string | null;
    supplierSku?: string | null;
    supplierCostPrice?: string | null;
    productCostPrice?: string | null;
  }[];
  /** Pending or completed receipts — any one of them locks an approved order's lines. */
  activeReceiptCount?: number;
  /** Server's answer to "can quantities and costs still change?" (canEditPurchaseLines). */
  linesEditable?: boolean;
};

type DraftLine = DraftDetail["items"][number];

function money(n: number): string {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Unit cost a line will be priced at on the PO, and where it comes from. */
function lineUnitCost(line: DraftLine) {
  return resolvePurchaseUnitCost({
    lineCost: line.estimatedCost,
    supplierCost: line.supplierCostPrice,
    productCost: line.productCostPrice,
  });
}

/** Provenance recorded when a draft is raised from a replenishment recommendation. */
type SourceRecommendation = {
  productName?: string;
  locationName?: string;
  actionType?: string;
  risk?: string;
  stock?: number;
  velocityPerDay?: number;
  targetCoverageDays?: number;
  onOrderQty?: number;
  requiredQty?: number;
  roundedBuyQty?: number;
  explain?: { whyAction?: string; packNotes?: string[]; warnings?: string[] };
};

/**
 * Batch-created drafts store `{ recommendations: [...] }`; drafts raised one at
 * a time store a single recommendation. Both shapes are read here.
 */
type SourceRecommendationJson =
  | SourceRecommendation
  | { recommendations?: SourceRecommendation[] };

function readSourceRecommendations(
  source: SourceRecommendationJson | null | undefined,
): SourceRecommendation[] {
  if (!source) return [];
  if ("recommendations" in source && Array.isArray(source.recommendations)) {
    return source.recommendations;
  }
  return [source as SourceRecommendation];
}

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
  // The server (STATUS_FLOW in purchaseDrafts.ts) already allows reviewed →
  // draft — quantities were previously stuck read-only forever once a draft
  // was marked reviewed because the client never offered a way back.
  reviewed: ["approved", "cancelled", "draft"],
  approved: ["cancelled"],
  partially_received: ["cancelled"],
  fully_received: [],
  cancelled: [],
};

const STATUS_ACTION_LABEL: Record<string, string> = {
  draft: "Back to draft",
};

/**
 * Mirrors PURCHASE_ORDER_EXPORTABLE_STATUSES in server/services/purchaseDrafts.ts:
 * a PO document is only meaningful once a draft has actually been approved.
 */
const PO_EXPORTABLE_STATUSES = new Set(["approved", "partially_received", "fully_received"]);

const STATUS_HELP: Record<string, string> = {
  draft: "Internal only — nothing is sent to the supplier automatically.",
  reviewed: "Ready for manager approval.",
  approved: "Approved — export a purchase order to send to the supplier. Stock increases only via goods receiving.",
  partially_received: "Some lines received — complete remaining receipts.",
  fully_received: "All ordered quantity received — read-only.",
  cancelled: "Cancelled — cannot receive against this draft.",
};

export default function PurchaseDraftsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canMutate =
    user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "MANAGER";

  const [detailId, setDetailId] = useState<string | null>(() => readQueryParam("draft"));
  const [editQty, setEditQty] = useState<Record<string, string>>({});
  const [editCost, setEditCost] = useState<Record<string, string>>({});
  const [lineSaveState, setLineSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  /** Set when closing the draft could not save typed values — offers Discard or Keep editing. */
  const [closeBlocked, setCloseBlocked] = useState<string | null>(null);
  const [overDeliveryKey, setOverDeliveryKey] = useState<string | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveQty, setReceiveQty] = useState<Record<string, { received: string; damaged: string }>>({});
  // The supplier's own invoice/delivery-note number — captured when goods are
  // actually received (ARC-019), never invented on the buyer's side.
  const [receiveSupplierReference, setReceiveSupplierReference] = useState("");
  const [exportingPoId, setExportingPoId] = useState<string | null>(null);

  // A deep-linked draft opens once; drop the param so closing the dialog (or
  // refreshing) does not immediately re-open it.
  useEffect(() => {
    if (readQueryParam("draft")) clearQueryParams(["draft"]);
  }, []);

  const { data: drafts = [], isLoading } = useQuery<DraftListItem[]>({
    queryKey: ["/api/purchase-drafts"],
  });

  const detailKey = detailId ? [`/api/purchase-drafts/${detailId}`] : ["skip"];
  const { data: detail } = useQuery<DraftDetail>({
    queryKey: detailKey,
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

  // ---- Line editing -------------------------------------------------------
  //
  // Quantity and unit cost save when the field loses focus or Enter is
  // pressed; a status change, an export, or closing the draft saves anything
  // still typed first. Saves for one line run strictly one after another, and
  // always read the LATEST typed value and the last value known to be saved
  // (refs, not render-time closures), so:
  //   - a value typed while an earlier save is in flight is kept, not wiped;
  //   - a blur-save and an Approve click never double-send or race;
  //   - nothing typed is ever silently dropped — the owner's original bug.
  const editQtyRef = useRef(editQty);
  editQtyRef.current = editQty;
  const editCostRef = useRef(editCost);
  editCostRef.current = editCost;
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const savedRef = useRef(new Map<string, SavedLine>());
  const saveChains = useRef(new Map<string, Promise<void>>());

  const hasEdits = (lineId: string) =>
    editQtyRef.current[lineId] !== undefined || editCostRef.current[lineId] !== undefined;
  const anyEdits = () => Object.keys(editQtyRef.current).length + Object.keys(editCostRef.current).length > 0;

  const discardEdits = useCallback(() => {
    setEditQty({});
    setEditCost({});
    setLineSaveState({});
    setCloseBlocked(null);
  }, []);

  // A different draft, or this one's lines becoming locked (goods booked in
  // from another screen), makes any leftover typing meaningless: drop it
  // rather than let it block the next status change with a doomed save.
  useEffect(() => {
    savedRef.current.clear();
    discardEdits();
  }, [detailId, discardEdits]);
  useEffect(() => {
    if (detail && !detail.linesEditable) discardEdits();
  }, [detail?.linesEditable, discardEdits]);

  const doSave = async (draftId: string, lineId: string) => {
    const line = detailRef.current?.items.find((l) => l.id === lineId);
    if (!line) return;
    const qtyRaw = editQtyRef.current[lineId];
    const costRaw = editCostRef.current[lineId];
    const saved = savedRef.current.get(lineId) ?? { quantity: line.quantity, estimatedCost: line.estimatedCost };
    const { quantity, estimatedCost, invalid } = pendingLineChange(saved, qtyRaw, costRaw);

    // Only clear a field if it still holds what this save was working from.
    const clearIfUnchanged = () => {
      setEditQty((prev) => {
        if (prev[lineId] !== qtyRaw) return prev;
        const { [lineId]: _q, ...rest } = prev;
        return rest;
      });
      setEditCost((prev) => {
        if (prev[lineId] !== costRaw) return prev;
        const { [lineId]: _c, ...rest } = prev;
        return rest;
      });
    };

    if (invalid) {
      setLineSaveState((st) => ({ ...st, [lineId]: "error" }));
      throw new Error(
        invalid === "quantity"
          ? `${line.productName}: enter a positive quantity with up to 3 decimal places.`
          : `${line.productName}: enter a unit cost above £0 with up to 2 decimal places, or leave it blank to use the supplier or product-card price.`,
      );
    }
    if (quantity === undefined && estimatedCost === undefined) {
      clearIfUnchanged();
      return;
    }

    setLineSaveState((st) => ({ ...st, [lineId]: "saving" }));
    try {
      const res = await apiRequest("PATCH", `/api/purchase-drafts/${draftId}/items/${lineId}`, {
        ...(quantity !== undefined ? { quantity } : {}),
        ...(estimatedCost !== undefined ? { estimatedCost } : {}),
      });
      const body = (await res.json()) as {
        quantity: number;
        estimatedCost: string | null;
        amendedAfterApproval?: boolean;
      };
      savedRef.current.set(lineId, { quantity: body.quantity, estimatedCost: body.estimatedCost });
      // Show the saved figures straight away rather than flicking back to the
      // old ones until the refetch lands.
      queryClient.setQueryData<DraftDetail>([`/api/purchase-drafts/${draftId}`], (current) =>
        current
          ? {
              ...current,
              items: current.items.map((l) =>
                l.id === lineId ? { ...l, quantity: body.quantity, estimatedCost: body.estimatedCost } : l,
              ),
            }
          : current,
      );
      clearIfUnchanged();
      setLineSaveState((st) => ({ ...st, [lineId]: "saved" }));
      invalidatePurchasingPipeline(queryClient);
      if (body.amendedAfterApproval) {
        toast({
          title: "Approved order changed",
          description: "Export the purchase order again and send the new copy to the supplier.",
        });
      }
    } catch (e) {
      setLineSaveState((st) => ({ ...st, [lineId]: "error" }));
      throw e;
    }
  };

  /** Queues a save for one line behind any save already running for it. */
  const saveLine = (draftId: string, lineId: string): Promise<void> => {
    const previous = saveChains.current.get(lineId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => doSave(draftId, lineId));
    saveChains.current.set(lineId, next);
    return next;
  };

  /** Saves a line when the user leaves its field or presses Enter. */
  const commitLine = (draftId: string, lineId: string) => {
    saveLine(draftId, lineId).catch((e: Error) =>
      toast({ title: "Line not saved", description: e.message, variant: "destructive" }),
    );
  };

  /**
   * Waits for every save in flight and saves every line still holding typed
   * values. Rejects — and so stops the caller — if any of them fail.
   */
  const flushDirtyLines = async (d: DraftDetail) => {
    await Promise.all([...saveChains.current.values()].map((p) => p.catch(() => undefined)));
    for (const line of d.items) {
      if (hasEdits(line.id)) await saveLine(d.id, line.id);
    }
  };

  /** Closing (Close, Escape, a tap outside) saves typed values first; if that fails, asks. */
  const requestCloseDetail = async () => {
    const d = detailRef.current;
    if (d && d.linesEditable && anyEdits()) {
      try {
        await flushDirtyLines(d);
      } catch (e) {
        setCloseBlocked(e instanceof Error ? e.message : "Some changes could not be saved.");
        return;
      }
    }
    discardEdits();
    setDetailId(null);
    clearQueryParams(["draft"]);
  };

  const closeDetail = () => {
    discardEdits();
    setDetailId(null);
    clearQueryParams(["draft"]);
  };

  /** The detail as it stands after any pending saves have landed in the cache. */
  const latestDetail = (id: string) =>
    queryClient.getQueryData<DraftDetail>([`/api/purchase-drafts/${id}`]) ?? detailRef.current;

  const receiveLines = (receiving?.items ?? []).map((line) => ({
    id: line.id,
    productName: line.productName,
    remaining: line.remaining,
    received: receiveQty[line.id]?.received,
  }));
  const overDelivery = overDeliveryState(receiveLines, overDeliveryKey);

  const createReceipt = useMutation({
    mutationFn: async () => {
      if (!detailId) return;
      const items = (receiving?.items ?? [])
        .map((item) => {
          const q = receiveQty[item.id];
          const received = parseQuantityInput(q?.received ?? "");
          const damaged = parseNonNegativeQuantityInput(q?.damaged ?? "") ?? 0;
          if (received === null) return null;
          return {
            purchaseDraftItemId: item.id,
            productId: item.productId,
            quantityReceived: received,
            quantityDamaged: damaged,
          };
        })
        .filter(Boolean);
      return apiRequest("POST", "/api/goods-receipts", {
        purchaseDraftId: detailId,
        supplierReference: receiveSupplierReference.trim() || undefined,
        items,
        acceptOverDeliveryLineIds: overDelivery.acceptLineIds.length ? overDelivery.acceptLineIds : undefined,
      });
    },
    onSuccess: async (res) => {
      const body = res ? ((await res.json()) as { id: string }) : null;
      invalidatePurchasingPipeline(queryClient);
      setReceiveOpen(false);
      setReceiveQty({});
      setReceiveSupplierReference("");
      setOverDeliveryKey(null);
      toast({
        title: "Pending receipt created",
        description: body ? (
          <span>
            Stock increases when you complete it —{" "}
            <Link href={receiptLink(body.id)} className="underline">
              open receipt {body.id.slice(0, 8)}…
            </Link>
          </span>
        ) : (
          "Complete it in Receiving to increase stock."
        ),
      });
    },
    onError: (e: Error) => {
      // The outstanding figures may be stale (another receipt, an amended
      // order): refetch them and make the manager look again.
      if (detailId) {
        void queryClient.invalidateQueries({ queryKey: [`/api/purchase-drafts/${detailId}/receiving`] });
      }
      setOverDeliveryKey(null);
      toast({ title: "Receipt not created", description: e.message, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    // Anything typed into a line but not yet saved goes first. Previously a
    // quantity only persisted via its own Save button, so typing 10000 and
    // pressing Approve discarded it silently and locked the order at the
    // recommended quantity. Cancelling (or lines that can no longer change)
    // discards typing instead — there is nothing left to save it to.
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const d = detailRef.current;
      if (d && d.id === id) {
        if (status === "cancelled" || !d.linesEditable) discardEdits();
        else await flushDirtyLines(d);
      }
      return apiRequest("PATCH", `/api/purchase-drafts/${id}/status`, { status });
    },
    onSuccess: () => {
      invalidatePurchasingPipeline(queryClient);
      toast({ title: "Status updated" });
    },
    onError: (e: Error) =>
      toast({ title: "Status change failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/purchase-drafts/${id}`),
    onSuccess: () => {
      invalidatePurchasingPipeline(queryClient);
      closeDetail();
      toast({ title: "Draft deleted" });
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  /** Exports must carry what is on screen: save typed values first, or stop. */
  const flushBeforeExport = async (d: DraftDetail): Promise<DraftDetail | null> => {
    if (!d.linesEditable || !anyEdits()) return latestDetail(d.id) ?? d;
    try {
      await flushDirtyLines(d);
      return latestDetail(d.id) ?? d;
    } catch (e) {
      toast({
        title: "Not exported",
        description: `Fix the line that could not be saved first. ${e instanceof Error ? e.message : ""}`,
        variant: "destructive",
      });
      return null;
    }
  };

  const exportCsv = async (draft: DraftDetail) => {
    const d = await flushBeforeExport(draft);
    if (!d) return;
    // The shared writer (FIX-14): quoted, formula-safe, UTF-8 marked.
    const csv = csvDocument(
      ["SKU", "Product", "Qty", "Unit cost", "Line total", "Supplier SKU"],
      d.items.map((line) => {
        const { unitCost } = lineUnitCost(line);
        const cost = unitCost != null ? unitCost.toFixed(2) : "";
        const total = unitCost != null ? (unitCost * line.quantity).toFixed(2) : "";
        return [line.sku, line.productName, line.quantity, cost, total, line.supplierSku ?? ""];
      }),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchase-draft-${d.id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * ARC-019: the printable/shareable purchase-order document — supplier
   * identity, a PO reference, line items and dates — generated server-side
   * and downloaded as a PDF. Distinct from `exportCsv` above, which is a bare
   * internal working list with no supplier identity on it at all.
   */
  const exportPurchaseOrder = async (draft: DraftDetail) => {
    setExportingPoId(draft.id);
    try {
      const d = await flushBeforeExport(draft);
      if (!d) return;
      const res = await apiRequest("GET", `/api/purchase-drafts/${d.id}/export`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `PO-${d.id.slice(0, 8).toUpperCase()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({
        title: "Could not generate purchase order",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setExportingPoId(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <PageHeader
          title="Purchase Drafts"
          question="What do you need to reorder?"
          explanation="No order is placed automatically and no payment is made. Once approved, export a purchase order to hand or send to the supplier yourself — stock increases only when a goods receipt is completed."
        />

        <Card>
          <CardHeader>
            <CardTitle>Drafts</CardTitle>
            <CardDescription>Created from replenishment recommendations or manually</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!isLoading && drafts.length === 0 && (
              <p className="text-sm text-muted-foreground">No purchase drafts yet.</p>
            )}
            {drafts.length > 0 && (
              <>
                {/* Desktop table — the whole row opens the draft, plus an explicit
                    View button for mouse users. */}
                <div className="hidden md:block">
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
                        <TableRow
                          key={d.id}
                          className="cursor-pointer"
                          onClick={() => setDetailId(d.id)}
                        >
                          <TableCell>{d.supplierName}</TableCell>
                          <TableCell>{d.locationName}</TableCell>
                          <TableCell>
                            {d.lineCount} lines / {d.totalQty} units
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant[d.status] ?? "outline"}>{d.status}</Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetailId(d.id);
                              }}
                            >
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile cards — the 5-column table above is unusable at phone
                    widths (the View button scrolls off with no scroll affordance). */}
                <div className="md:hidden space-y-3">
                  {drafts.map((d) => (
                    <Card
                      key={d.id}
                      className="cursor-pointer"
                      onClick={() => setDetailId(d.id)}
                    >
                      <CardContent className="pt-4 space-y-2">
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <p className="font-medium">{d.supplierName}</p>
                            <p className="text-sm text-muted-foreground">{d.locationName}</p>
                          </div>
                          <Badge variant={statusVariant[d.status] ?? "outline"}>{d.status}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {d.lineCount} lines / {d.totalQty} units
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full min-h-[44px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailId(d.id);
                          }}
                        >
                          View
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!detailId} onOpenChange={(open) => !open && void requestCloseDetail()}>
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
                        {STATUS_ACTION_LABEL[s] ?? `Mark ${s}`}
                      </Button>
                    ))}
                  <Button size="sm" variant="ghost" onClick={() => void exportCsv(detail)}>
                    <Download className="h-4 w-4 mr-1" />
                    CSV
                  </Button>
                  {PO_EXPORTABLE_STATUSES.has(detail.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void exportPurchaseOrder(detail)}
                      disabled={exportingPoId === detail.id}
                      data-testid="button-export-po"
                    >
                      <FileText className="h-4 w-4 mr-1" />
                      {exportingPoId === detail.id ? "Generating…" : "Export PO"}
                    </Button>
                  )}
                  {canMutate &&
                    (detail.status === "approved" || detail.status === "partially_received") && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setReceiveSupplierReference("");
                          setOverDeliveryKey(null);
                          setReceiveOpen(true);
                        }}
                      >
                        <PackageCheck className="h-4 w-4 mr-1" />
                        Receive goods
                      </Button>
                    )}
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={withQuery("/inventory", { tab: "receiving" })}>Receiving tab</Link>
                  </Button>
                  {canMutate && detail.status !== "cancelled" && detail.status !== "fully_received" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(detail.id)}
                      className="gap-1"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      Delete draft
                    </Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{STATUS_HELP[detail.status]}</p>
                {(() => {
                  const sources = readSourceRecommendations(detail.sourceRecommendationJson);
                  if (!sources.length) return null;
                  const cover = sources.find(
                    (s) => typeof s.targetCoverageDays === "number",
                  )?.targetCoverageDays;
                  return (
                    <div className="rounded border bg-muted/40 p-3 space-y-2">
                      <p className="text-xs font-medium uppercase text-muted-foreground">
                        Why this was ordered
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Raised from {sources.length} replenishment recommendation
                        {sources.length === 1 ? "" : "s"}
                        {typeof cover === "number" ? ` · ${cover}-day target cover` : ""}
                      </p>
                      <ul className="space-y-1">
                        {sources.map((s, idx) => (
                          <li key={`${s.productName ?? "line"}-${idx}`} className="text-sm">
                            {s.productName && (
                              <span className="font-medium">{s.productName}: </span>
                            )}
                            {s.explain?.whyAction ?? "No rationale recorded"}
                            {typeof s.onOrderQty === "number" && s.onOrderQty > 0 && (
                              <span className="text-muted-foreground">
                                {" "}
                                ({s.onOrderQty} already on order at the time)
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
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
                              {r.status} · {r.createdAt ? new Date(r.createdAt).toLocaleString("en-GB") : ""}
                            </span>
                            <Link href={receiptLink(r.id)} className="text-primary underline text-xs">
                              Receipt {r.id.slice(0, 8)}…
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {closeBlocked && (
                  <div
                    className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm space-y-2"
                    role="alert"
                    data-testid="draft-close-blocked"
                  >
                    <p className="font-medium">Some changes have not been saved</p>
                    <p className="text-muted-foreground">{closeBlocked}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setCloseBlocked(null)}>
                        Keep editing
                      </Button>
                      <Button size="sm" variant="destructive" onClick={closeDetail}>
                        Discard changes and close
                      </Button>
                    </div>
                  </div>
                )}
                {detail.status === "approved" && detail.linesEditable && canMutate && (
                  <p className="text-xs rounded border border-amber-500/40 bg-amber-500/10 p-2">
                    Nothing has been booked in yet, so you can still change quantities and costs.
                    If you do, export the purchase order again and re-send it to the supplier.
                  </p>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="hidden sm:table-cell">SKU</TableHead>
                      <TableHead>Ordered</TableHead>
                      <TableHead>Unit cost</TableHead>
                      <TableHead className="hidden sm:table-cell">Line total</TableHead>
                      <TableHead>Received</TableHead>
                      <TableHead>Remaining</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.map((line) => {
                      const rec = receiving?.items.find((i) => i.id === line.id);
                      const canEditLine = canMutate && !!detail.linesEditable;
                      const { unitCost, source } = lineUnitCost(line);
                      const lineTotal = unitCost != null ? unitCost * line.quantity : null;
                      const saveState = lineSaveState[line.id];
                      const dirty = editQty[line.id] !== undefined || editCost[line.id] !== undefined;
                      const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      };
                      return (
                        <TableRow key={line.id}>
                          <TableCell>
                            {line.productName}
                            {canEditLine && (dirty || saveState) && (
                              <span
                                className={`block text-xs ${saveState === "error" ? "text-destructive" : "text-muted-foreground"}`}
                                aria-live="polite"
                              >
                                {saveState === "saving"
                                  ? "Saving…"
                                  : saveState === "error"
                                    ? "Not saved — check the value"
                                    : dirty
                                      ? "Unsaved"
                                      : "Saved"}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">{line.sku}</TableCell>
                          <TableCell>
                            {canEditLine ? (
                              // Saves on leaving the field or pressing Enter; a
                              // status change saves it too. There used to be a
                              // separate Save button, and skipping it lost the edit.
                              <Input
                                className="w-full sm:w-24"
                                inputMode="decimal"
                                aria-label={`Quantity for ${line.productName}`}
                                data-testid={`input-draft-qty-${line.id}`}
                                value={editQty[line.id] ?? String(line.quantity)}
                                onChange={(e) => {
                                  setEditQty({ ...editQty, [line.id]: e.target.value });
                                  setLineSaveState(({ [line.id]: _s, ...rest }) => rest);
                                }}
                                onBlur={() => commitLine(detail.id, line.id)}
                                onKeyDown={onEnter}
                              />
                            ) : (
                              line.quantity
                            )}
                          </TableCell>
                          <TableCell>
                            {canEditLine ? (
                              <Input
                                className="w-full sm:w-24"
                                inputMode="decimal"
                                aria-label={`Unit cost for ${line.productName}`}
                                data-testid={`input-draft-cost-${line.id}`}
                                placeholder={source !== "line" && unitCost != null ? unitCost.toFixed(2) : "0.00"}
                                value={editCost[line.id] ?? (line.estimatedCost ?? "")}
                                onChange={(e) => {
                                  setEditCost({ ...editCost, [line.id]: e.target.value });
                                  setLineSaveState(({ [line.id]: _s, ...rest }) => rest);
                                }}
                                onBlur={() => commitLine(detail.id, line.id)}
                                onKeyDown={onEnter}
                              />
                            ) : unitCost != null ? (
                              money(unitCost)
                            ) : (
                              "—"
                            )}
                            {(source === "product" || source === "supplier") && (
                              <span className="block text-xs text-muted-foreground">
                                {source === "product" ? "from product card" : "supplier price"}
                              </span>
                            )}
                            {unitCost == null && (
                              <span className="block text-xs text-amber-600 dark:text-amber-400">
                                No cost on the product or supplier
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {lineTotal != null ? money(lineTotal) : "—"}
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
                {(() => {
                  const total = detail.items.reduce((sum, line) => {
                    const { unitCost } = lineUnitCost(line);
                    return unitCost != null ? sum + unitCost * line.quantity : sum;
                  }, 0);
                  const uncosted = detail.items.filter((line) => lineUnitCost(line).unitCost == null).length;
                  return (
                    <p className="text-sm font-medium" data-testid="text-draft-estimated-total">
                      Estimated order total: {money(total)}
                      {uncosted > 0 && (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          ({uncosted} line{uncosted === 1 ? "" : "s"} without a cost)
                        </span>
                      )}
                    </p>
                  );
                })()}
                <p className="text-xs text-muted-foreground">
                  Approving does not place an order automatically — export a purchase order above to
                  send to the supplier yourself. Complete a goods receipt to increase stock.
                </p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => void requestCloseDetail()}>
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
              <div>
                <Label htmlFor="supplier-reference">Supplier reference (optional)</Label>
                <Input
                  id="supplier-reference"
                  value={receiveSupplierReference}
                  onChange={(e) => setReceiveSupplierReference(e.target.value)}
                  placeholder="Supplier's delivery note or invoice number"
                  data-testid="input-supplier-reference"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  The supplier's own reference for this delivery, if they gave you one — not a number
                  we generate.
                </p>
              </div>
              {receiving?.items.map((item) => (
                <div key={item.id} className="border rounded p-3 space-y-2">
                  <p className="font-medium text-sm">
                    {item.productName} — remaining {item.remaining}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Qty received</Label>
                      <Input aria-label="Qty received"
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min={0}
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
                      <Input aria-label="Damaged"
                        type="number"
                        inputMode="decimal"
                        step="any"
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
            <OverDeliveryConfirm
              lines={receiveLines}
              confirmedKey={overDeliveryKey}
              onConfirmedKeyChange={setOverDeliveryKey}
            />
            <DialogFooter>
              <Button
                onClick={() => createReceipt.mutate()}
                disabled={createReceipt.isPending || overDelivery.blocked}
              >
                Create pending receipt
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}
