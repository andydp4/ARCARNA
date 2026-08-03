import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { invalidatePurchasingPipeline } from "@/lib/query-invalidation";
import { purchaseDraftLink } from "@/lib/deepLink";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";
import { Checkbox } from "@/components/ui/checkbox";
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
import { HelpCircle, PackagePlus, ArrowRightLeft, ShoppingCart } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Location = { id: string; name: string };

type Recommendation = {
  productId: string;
  productName: string;
  sku: string;
  locationId: string;
  locationName: string;
  actionType: string;
  risk: string;
  stock: number;
  velocityPerDay: number;
  daysToDepletion: number | null;
  grossRequiredQty: number;
  onOrderQty: number;
  requiredQty: number;
  transferableQty: number;
  roundedBuyQty: number;
  transferSources: { locationId: string; locationName: string; suggestedQty: number }[];
  selectedSupplier: {
    supplierId: string;
    supplierName: string;
    supplierSku: string | null;
    costPrice: string | null;
  } | null;
  explain: { whyAction: string; packNotes: string[]; warnings: string[] };
};

type RecResponse = {
  summary: {
    total: number;
    noAction: number;
    transfer: number;
    buy: number;
    transferPlusBuy: number;
    highRisk: number;
    onOrder: number;
  };
  items: Recommendation[];
  targetCoverageDays: number;
};

type BatchDraftResponse = {
  drafts: { id: string; supplierName: string; locationName: string }[];
  created: number;
  lineCount: number;
  existingOpenDrafts: { id: string; supplierName: string; locationName: string; status: string }[];
};

const recKey = (rec: Pick<Recommendation, "productId" | "locationId">) =>
  `${rec.productId}:${rec.locationId}`;

/** A recommendation can be turned into a purchase line only with a supplier and a quantity. */
const isBuyable = (rec: Recommendation) =>
  rec.actionType.includes("BUY") && rec.roundedBuyQty > 0 && !!rec.selectedSupplier;

const actionVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  NO_ACTION: "secondary",
  TRANSFER: "outline",
  BUY: "default",
  TRANSFER_PLUS_BUY: "default",
};

const riskVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  low: "secondary",
  medium: "outline",
  high: "default",
  critical: "destructive",
};

export function ReplenishmentTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canMutate =
    user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "MANAGER";

  const [locationId, setLocationId] = useState<string>("all");
  const [actionType, setActionType] = useState<string>("all");
  const [risk, setRisk] = useState<string>("all");
  const [targetCoverageDays, setTargetCoverageDays] = useState("14");
  const [search, setSearch] = useState("");
  const [whyItem, setWhyItem] = useState<Recommendation | null>(null);
  const [confirmItem, setConfirmItem] = useState<Recommendation | null>(null);
  const [confirmKind, setConfirmKind] = useState<"transfer" | "purchase" | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [batchOpen, setBatchOpen] = useState(false);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (locationId !== "all") p.set("locationId", locationId);
    if (actionType !== "all") p.set("actionType", actionType);
    if (risk !== "all") p.set("risk", risk);
    p.set("targetCoverageDays", targetCoverageDays);
    p.set("limit", "100");
    return p.toString();
  }, [locationId, actionType, risk, targetCoverageDays]);

  const { data, isLoading } = useQuery<RecResponse>({
    queryKey: [`/api/replenishment/recommendations?${queryParams}`],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) =>
        i.productName.toLowerCase().includes(q) ||
        i.sku.toLowerCase().includes(q) ||
        i.locationName.toLowerCase().includes(q),
    );
  }, [data?.items, search]);

  const buyableVisible = useMemo(() => filtered.filter(isBuyable), [filtered]);

  const selectedItems = useMemo(
    () => buyableVisible.filter((i) => selected[recKey(i)]),
    [buyableVisible, selected],
  );

  /** Distinct supplier+location pairs — the number of drafts a batch will raise. */
  const selectedGroupCount = useMemo(
    () =>
      new Set(selectedItems.map((i) => `${i.selectedSupplier!.supplierId}:${i.locationId}`)).size,
    [selectedItems],
  );

  const allVisibleSelected =
    buyableVisible.length > 0 && selectedItems.length === buyableVisible.length;

  const toggleAllVisible = (checked: boolean) => {
    const next = { ...selected };
    for (const rec of buyableVisible) {
      if (checked) next[recKey(rec)] = true;
      else delete next[recKey(rec)];
    }
    setSelected(next);
  };

  const transferDraft = useMutation({
    mutationFn: async (item: Recommendation) => {
      const items = item.transferSources.map((s) => ({
        productId: item.productId,
        fromLocationId: s.locationId,
        quantity: s.suggestedQty,
      }));
      return apiRequest("POST", "/api/replenishment/create-transfer-draft", {
        toLocationId: item.locationId,
        items,
        sourceRecommendationJson: item,
      });
    },
    onSuccess: async (res) => {
      const body = (await res.json()) as { id?: string };
      invalidatePurchasingPipeline(queryClient);
      setConfirmItem(null);
      setConfirmKind(null);
      toast({
        title: "Transfer draft created",
        description: body?.id
          ? `Draft ${body.id.slice(0, 8)}… — no stock moved yet`
          : "No stock moved yet",
      });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  /**
   * Purchase lines are always sent through the batch endpoint — a single
   * recommendation is just a batch of one, and the server groups by
   * supplier+location so one supplier never yields several drafts.
   */
  const purchaseDraft = useMutation({
    mutationFn: async (recs: Recommendation[]) => {
      const lines = recs.filter(isBuyable).map((rec) => ({
        supplierId: rec.selectedSupplier!.supplierId,
        locationId: rec.locationId,
        productId: rec.productId,
        quantity: rec.roundedBuyQty,
        estimatedCost:
          rec.selectedSupplier!.costPrice != null
            ? Number(rec.selectedSupplier!.costPrice)
            : undefined,
        supplierSku: rec.selectedSupplier!.supplierSku ?? undefined,
        recommendation: rec,
      }));

      if (!lines.length) throw new Error("No purchasable lines selected");

      const res = await apiRequest("POST", "/api/replenishment/create-purchase-drafts", { lines });
      return (await res.json()) as BatchDraftResponse;
    },
    onSuccess: (body) => {
      // Recommendations net off open drafts, so they must refetch or the same
      // shortfall stays on screen and invites a duplicate order.
      invalidatePurchasingPipeline(queryClient);
      setConfirmItem(null);
      setConfirmKind(null);
      setBatchOpen(false);
      setSelected({});

      const single = body.created === 1 ? body.drafts[0] : null;
      toast({
        title:
          body.created === 1
            ? "Purchase draft created"
            : `${body.created} purchase drafts created`,
        description: (
          <span>
            {body.lineCount} line(s) grouped by supplier.{" "}
            <Link
              href={single ? purchaseDraftLink(single.id) : "/purchase-drafts"}
              className="underline"
            >
              {single ? `Open draft ${single.id.slice(0, 8)}…` : "View drafts"}
            </Link>
            {body.existingOpenDrafts.length > 0 && (
              <span className="block mt-1">
                Note: {body.existingOpenDrafts.length} other open draft(s) already exist for the
                same supplier and location.
              </span>
            )}
          </span>
        ),
      });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Needs action</CardDescription>
            <CardTitle className="text-2xl">
              {(summary?.transfer ?? 0) + (summary?.buy ?? 0) + (summary?.transferPlusBuy ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>High risk</CardDescription>
            <CardTitle className="text-2xl">{summary?.highRisk ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Transfer only</CardDescription>
            <CardTitle className="text-2xl">{summary?.transfer ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Buy / mixed</CardDescription>
            <CardTitle className="text-2xl">
              {(summary?.buy ?? 0) + (summary?.transferPlusBuy ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Already on order</CardDescription>
            <CardTitle className="text-2xl">{summary?.onOrder ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Label>Location</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Action</Label>
            <Select value={actionType} onValueChange={setActionType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="TRANSFER">Transfer</SelectItem>
                <SelectItem value="BUY">Buy</SelectItem>
                <SelectItem value="TRANSFER_PLUS_BUY">Transfer + Buy</SelectItem>
                <SelectItem value="NO_ACTION">No action</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Risk</Label>
            <Select value={risk} onValueChange={setRisk}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Coverage (days)</Label>
            <Input
              type="number"
              min={1}
              value={targetCoverageDays}
              onChange={(e) => setTargetCoverageDays(e.target.value)}
            />
          </div>
          <div>
            <Label>Search</Label>
            <Input placeholder="Product or SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {isLoading && <p className="text-muted-foreground text-sm">Loading recommendations…</p>}

      {canMutate && buyableVisible.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border p-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={(c) => toggleAllVisible(c === true)}
              aria-label="Select all purchasable recommendations"
              data-testid="replenishment-select-all"
            />
            Select all purchasable ({buyableVisible.length})
          </label>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {selectedItems.length} selected
              {selectedGroupCount > 0 &&
                ` → ${selectedGroupCount} draft${selectedGroupCount === 1 ? "" : "s"}`}
            </span>
            <Button
              size="sm"
              disabled={selectedItems.length === 0 || purchaseDraft.isPending}
              onClick={() => setBatchOpen(true)}
              data-testid="replenishment-create-batch"
            >
              <ShoppingCart className="h-4 w-4 mr-1" />
              Create purchase drafts
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((rec) => (
          <Card key={`${rec.productId}-${rec.locationId}`} data-testid="replenishment-card">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  {canMutate && isBuyable(rec) && (
                    <Checkbox
                      className="mt-1"
                      checked={!!selected[recKey(rec)]}
                      onCheckedChange={(c) =>
                        setSelected((prev) => {
                          const next = { ...prev };
                          if (c === true) next[recKey(rec)] = true;
                          else delete next[recKey(rec)];
                          return next;
                        })
                      }
                      aria-label={`Select ${rec.productName} at ${rec.locationName} for purchase`}
                    />
                  )}
                  <div>
                    <CardTitle className="text-base">{rec.productName}</CardTitle>
                    <CardDescription>
                      {rec.sku} · {rec.locationName} · Stock {rec.stock}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant={actionVariant[rec.actionType] ?? "outline"}>
                    {rec.actionType.replace(/_/g, " ")}
                  </Badge>
                  <Badge variant={riskVariant[rec.risk] ?? "outline"}>{rec.risk}</Badge>
                  {rec.onOrderQty > 0 && (
                    <Badge variant="outline" title="Outstanding quantity on open purchase drafts">
                      {rec.onOrderQty} on order
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{rec.explain.whyAction}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setWhyItem(rec)}>
                  <HelpCircle className="h-4 w-4 mr-1" />
                  Why?
                </Button>
                {canMutate && rec.actionType.includes("TRANSFER") && rec.transferSources.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setConfirmItem(rec);
                      setConfirmKind("transfer");
                    }}
                  >
                    <ArrowRightLeft className="h-4 w-4 mr-1" />
                    Transfer draft
                  </Button>
                )}
                {canMutate &&
                  rec.actionType.includes("BUY") &&
                  rec.roundedBuyQty > 0 &&
                  rec.selectedSupplier && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setConfirmItem(rec);
                        setConfirmKind("purchase");
                      }}
                    >
                      <ShoppingCart className="h-4 w-4 mr-1" />
                      Purchase draft
                    </Button>
                  )}
                {canMutate && rec.actionType.includes("BUY") && !rec.selectedSupplier && (
                  <Button variant="ghost" size="sm" disabled title="Configure supplier mapping">
                    <PackagePlus className="h-4 w-4 mr-1" />
                    Purchase draft
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!isLoading && filtered.length === 0 && (
        <p className="text-muted-foreground text-sm">No recommendations match your filters.</p>
      )}

      <Dialog open={!!whyItem} onOpenChange={() => setWhyItem(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Why this recommendation?</DialogTitle>
          </DialogHeader>
          {whyItem && (
            <div className="space-y-3 text-sm">
              <p>
                <strong>Action:</strong> {whyItem.explain.whyAction}
              </p>
              <p>
                <strong>Stock:</strong> {whyItem.stock} · <strong>Velocity:</strong>{" "}
                {whyItem.velocityPerDay}/day · <strong>Depletion:</strong>{" "}
                {whyItem.daysToDepletion ?? "n/a"} days
              </p>
              <p>
                <strong>Gap to target:</strong> {whyItem.grossRequiredQty} ·{" "}
                <strong>On order:</strong> {whyItem.onOrderQty} · <strong>Still required:</strong>{" "}
                {whyItem.requiredQty}
              </p>
              <p>
                <strong>Transferable:</strong> {whyItem.transferableQty} ·{" "}
                <strong>Buy (rounded):</strong> {whyItem.roundedBuyQty}
              </p>
              {whyItem.transferSources.length > 0 && (
                <div>
                  <strong>Transfer sources:</strong>
                  <ul className="list-disc pl-5">
                    {whyItem.transferSources.map((s) => (
                      <li key={s.locationId}>
                        {s.locationName}: {s.suggestedQty} units
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {whyItem.selectedSupplier && (
                <p>
                  <strong>Supplier:</strong> {whyItem.selectedSupplier.supplierName}
                </p>
              )}
              {whyItem.explain.packNotes.map((n) => (
                <p key={n} className="text-muted-foreground">
                  {n}
                </p>
              ))}
              {whyItem.explain.warnings.map((w) => (
                <Alert key={w} variant="destructive">
                  <AlertDescription>{w}</AlertDescription>
                </Alert>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmItem && !!confirmKind}
        onOpenChange={() => {
          setConfirmItem(null);
          setConfirmKind(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Create {confirmKind === "transfer" ? "transfer" : "purchase"} draft?
            </DialogTitle>
            <DialogDescription>
              This creates an internal draft only. No stock is moved, no supplier order is sent, and
              no payment is made.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmItem(null);
                setConfirmKind(null);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={transferDraft.isPending || purchaseDraft.isPending}
              onClick={() => {
                if (!confirmItem) return;
                if (confirmKind === "transfer") transferDraft.mutate(confirmItem);
                else purchaseDraft.mutate([confirmItem]);
              }}
            >
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Create {selectedGroupCount} purchase draft{selectedGroupCount === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              {selectedItems.length} line(s) will be grouped into{" "}
              {selectedGroupCount} draft{selectedGroupCount === 1 ? "" : "s"}, one per supplier and
              location. This creates internal drafts only — no stock is moved, no supplier order is
              sent, and no payment is made.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {selectedItems.map((rec) => (
              <li key={recKey(rec)} className="flex justify-between gap-2">
                <span>
                  {rec.productName} · {rec.locationName}
                </span>
                <span className="text-muted-foreground">
                  {rec.roundedBuyQty} × {rec.selectedSupplier?.supplierName}
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={purchaseDraft.isPending}
              onClick={() => purchaseDraft.mutate(selectedItems)}
            >
              Create drafts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
