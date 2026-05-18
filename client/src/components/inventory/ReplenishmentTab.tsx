import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";
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
  requiredQty: number;
  transferableQty: number;
  roundedBuyQty: number;
  transferSources: { locationId: string; locationName: string; suggestedQty: number }[];
  selectedSupplier: { supplierId: string; supplierName: string } | null;
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
  };
  items: Recommendation[];
  targetCoverageDays: number;
};

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
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/transfers"] });
      setConfirmItem(null);
      toast({
        title: "Transfer draft created",
        description: `Draft ${res?.id ?? ""} — no stock moved yet`,
      });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const purchaseDraft = useMutation({
    mutationFn: async (item: Recommendation) => {
      if (!item.selectedSupplier) throw new Error("No supplier selected");
      return apiRequest("POST", "/api/replenishment/create-purchase-draft", {
        supplierId: item.selectedSupplier.supplierId,
        locationId: item.locationId,
        items: [
          {
            productId: item.productId,
            quantity: item.roundedBuyQty,
            estimatedCost: undefined,
          },
        ],
        sourceRecommendationJson: item,
      });
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-drafts"] });
      setConfirmItem(null);
      toast({
        title: "Purchase draft created",
        description: (
          <span>
            Draft {res?.id?.slice(0, 8)}… —{" "}
            <Link href="/purchase-drafts" className="underline">
              View drafts
            </Link>
          </span>
        ),
      });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((item) => (
          <Card key={`${item.productId}-${item.locationId}`} data-testid="replenishment-card">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{item.productName}</CardTitle>
                  <CardDescription>
                    {item.sku} · {item.locationName} · Stock {item.stock}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant={actionVariant[item.actionType] ?? "outline"}>
                    {item.actionType.replace(/_/g, " ")}
                  </Badge>
                  <Badge variant={riskVariant[item.risk] ?? "outline"}>{item.risk}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{item.explain.whyAction}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setWhyItem(item)}>
                  <HelpCircle className="h-4 w-4 mr-1" />
                  Why?
                </Button>
                {canMutate && item.actionType.includes("TRANSFER") && item.transferSources.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setConfirmItem(item);
                      setConfirmKind("transfer");
                    }}
                  >
                    <ArrowRightLeft className="h-4 w-4 mr-1" />
                    Transfer draft
                  </Button>
                )}
                {canMutate &&
                  item.actionType.includes("BUY") &&
                  item.roundedBuyQty > 0 &&
                  item.selectedSupplier && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setConfirmItem(item);
                        setConfirmKind("purchase");
                      }}
                    >
                      <ShoppingCart className="h-4 w-4 mr-1" />
                      Purchase draft
                    </Button>
                  )}
                {canMutate && item.actionType.includes("BUY") && !item.selectedSupplier && (
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
                <strong>Required:</strong> {whyItem.requiredQty} · <strong>Transferable:</strong>{" "}
                {whyItem.transferableQty} · <strong>Buy (rounded):</strong> {whyItem.roundedBuyQty}
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
              onClick={() => {
                if (!confirmItem) return;
                if (confirmKind === "transfer") transferDraft.mutate(confirmItem);
                else purchaseDraft.mutate(confirmItem);
              }}
            >
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
