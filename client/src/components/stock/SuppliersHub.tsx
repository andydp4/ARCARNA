import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SupplierCostCheck } from "@shared/purchasing/supplierCostCheck";
import { SUPPLIER_COST_TOLERANCE_PERCENT } from "@shared/purchasing/supplierCostCheck";

type Supplier = {
  id: string;
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  leadTimeDays: number;
  minOrderValue?: string | null;
  minOrderQuantity?: number | null;
  isActive: number;
};

type ProductSupplier = {
  id: string;
  productId: string;
  supplierId: string;
  supplierSku?: string | null;
  costPrice?: string | null;
  packSize: number;
  minOrderQty?: number | null;
  leadTimeOverrideDays?: number | null;
  isPreferred: number;
  productName: string;
  productSku?: string;
  /** The cost on the product card, beside the supplier's price. */
  productCostPrice?: string | null;
  /** Worked out on the server (shared/purchasing/supplierCostCheck.ts). */
  costCheck?: SupplierCostCheck;
  supplierName: string;
};

const money = (value: number | null | undefined) => (value == null ? "—" : `£${value.toFixed(2)}`);

/** What the flag says, in the shop's words. */
function costCheckLabel(check: SupplierCostCheck | undefined): string {
  if (!check) return "—";
  switch (check.status) {
    case "match":
      return "Matches";
    case "differs": {
      const pct = check.diffPercent ?? 0;
      return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}% vs card`;
    }
    case "missing-supplier":
      return "No supplier price";
    case "missing-card":
      return "No cost on card";
    default:
      return "No prices";
  }
}

type Product = { id: string; name: string; productId: string };

export function SuppliersHub() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canMutate =
    user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "MANAGER";

  const [supplierOpen, setSupplierOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [supplierForm, setSupplierForm] = useState({
    name: "",
    contactName: "",
    email: "",
    phone: "",
    leadTimeDays: "0",
    minOrderValue: "0",
    minOrderQuantity: "0",
  });
  const [mappingForm, setMappingForm] = useState({
    productId: "",
    supplierId: "",
    supplierSku: "",
    costPrice: "",
    packSize: "1",
    minOrderQty: "1",
    leadTimeOverrideDays: "",
    isPreferred: false,
  });

  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: mappings = [] } = useQuery<ProductSupplier[]>({
    queryKey: ["/api/product-suppliers"],
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const saveSupplier = useMutation({
    mutationFn: async () => {
      const body = {
        name: supplierForm.name,
        contactName: supplierForm.contactName || undefined,
        email: supplierForm.email || undefined,
        phone: supplierForm.phone || undefined,
        leadTimeDays: parseInt(supplierForm.leadTimeDays, 10) || 0,
        minOrderValue: parseFloat(supplierForm.minOrderValue) || 0,
        minOrderQuantity: parseInt(supplierForm.minOrderQuantity, 10) || 0,
      };
      if (editingSupplier) {
        return apiRequest("PATCH", `/api/suppliers/${editingSupplier.id}`, body);
      }
      return apiRequest("POST", "/api/suppliers", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      setSupplierOpen(false);
      setEditingSupplier(null);
      toast({ title: "Supplier saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteSupplier = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/suppliers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Supplier deactivated" });
    },
    // Without this the request can fail and the user sees nothing at all.
    onError: (error: unknown) => {
      toast({
        title: "Something went wrong",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const saveMapping = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/product-suppliers", {
        productId: mappingForm.productId,
        supplierId: mappingForm.supplierId,
        supplierSku: mappingForm.supplierSku || undefined,
        costPrice: mappingForm.costPrice ? parseFloat(mappingForm.costPrice) : undefined,
        packSize: parseInt(mappingForm.packSize, 10) || 1,
        minOrderQty: parseInt(mappingForm.minOrderQty, 10) || 1,
        leadTimeOverrideDays: mappingForm.leadTimeOverrideDays
          ? parseInt(mappingForm.leadTimeOverrideDays, 10)
          : undefined,
        isPreferred: mappingForm.isPreferred,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-suppliers"] });
      setMappingOpen(false);
      toast({ title: "Supplier price saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const togglePreferred = useMutation({
    mutationFn: (m: ProductSupplier) =>
      apiRequest("PATCH", `/api/product-suppliers/${m.id}`, { isPreferred: m.isPreferred !== 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/product-suppliers"] }),
    // Without this the request can fail and the user sees nothing at all.
    onError: (error: unknown) => {
      toast({
        title: "Something went wrong",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteMapping = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/product-suppliers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/product-suppliers"] }),
    // Without this the request can fail and the user sees nothing at all.
    onError: (error: unknown) => {
      toast({
        title: "Something went wrong",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const openEditSupplier = (s: Supplier) => {
    setEditingSupplier(s);
    setSupplierForm({
      name: s.name,
      contactName: s.contactName ?? "",
      email: s.email ?? "",
      phone: s.phone ?? "",
      leadTimeDays: String(s.leadTimeDays),
      minOrderValue: String(s.minOrderValue ?? 0),
      minOrderQuantity: String(s.minOrderQuantity ?? 0),
    });
    setSupplierOpen(true);
  };

  const activeSuppliers = suppliers.filter((s) => s.isActive === 1);
  const flaggedCount = mappings.filter((m) => m.costCheck?.flagged).length;
  const shownMappings = useMemo(
    () =>
      mappings.filter(
        (m) =>
          (supplierFilter === "all" || m.supplierId === supplierFilter) &&
          (!flaggedOnly || m.costCheck?.flagged),
      ),
    [mappings, supplierFilter, flaggedOnly],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Suppliers</CardTitle>
            <CardDescription>Manage supplier master data for replenishment</CardDescription>
          </div>
          {canMutate && (
            <Button
              size="sm"
              onClick={() => {
                setEditingSupplier(null);
                setSupplierForm({
                  name: "",
                  contactName: "",
                  email: "",
                  phone: "",
                  leadTimeDays: "0",
                  minOrderValue: "0",
                  minOrderQuantity: "0",
                });
                setSupplierOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add supplier
            </Button>
          )}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Lead time</TableHead>
                <TableHead>Min order</TableHead>
                {canMutate && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeSuppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.email || s.phone || "—"}</TableCell>
                  <TableCell>{s.leadTimeDays}d</TableCell>
                  <TableCell>
                    £{Number(s.minOrderValue ?? 0).toFixed(2)} / {s.minOrderQuantity ?? 0} qty
                  </TableCell>
                  {canMutate && (
                    <TableCell className="text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1"
                        aria-label={`Edit supplier ${s.name}`}
                        onClick={() => openEditSupplier(s)}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-destructive hover:text-destructive"
                        aria-label={`Delete supplier ${s.name}`}
                        onClick={() => deleteSupplier.mutate(s.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        Delete
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Supplier prices</CardTitle>
            <CardDescription>
              Each supplier's price beside the cost on the product card. Flagged when they differ by more than{" "}
              {SUPPLIER_COST_TOLERANCE_PERCENT}%, or when either is missing — margins are worked out from the card.
            </CardDescription>
          </div>
          {canMutate && (
            <Button size="sm" onClick={() => setMappingOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add supplier price
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-full sm:w-64">
              <Label htmlFor="supplier-price-filter" className="sr-only">
                Supplier
              </Label>
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger id="supplier-price-filter" data-testid="supplier-price-filter">
                  <SelectValue placeholder="All suppliers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All suppliers</SelectItem>
                  {activeSuppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="supplier-price-flagged-only"
                checked={flaggedOnly}
                onCheckedChange={setFlaggedOnly}
                data-testid="supplier-price-flagged-only"
              />
              <Label htmlFor="supplier-price-flagged-only">Only flagged ({flaggedCount})</Label>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Supplier price</TableHead>
                <TableHead className="text-right">Card cost</TableHead>
                <TableHead>Check</TableHead>
                <TableHead>Pack</TableHead>
                <TableHead>Preferred</TableHead>
                {canMutate && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownMappings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canMutate ? 8 : 7} className="text-center text-sm text-muted-foreground">
                    {flaggedOnly ? "Nothing flagged — every supplier price is within tolerance." : "No supplier prices yet."}
                  </TableCell>
                </TableRow>
              )}
              {shownMappings.map((m) => (
                <TableRow key={m.id} data-testid={`supplier-price-row-${m.id}`} data-flagged={m.costCheck?.flagged ? "true" : "false"}>
                  <TableCell>
                    {/* The product card this cost belongs to. */}
                    <Link
                      href={`/products?product=${encodeURIComponent(m.productId)}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {m.productName}
                    </Link>
                    {m.productSku && <div className="text-xs text-muted-foreground">{m.productSku}</div>}
                  </TableCell>
                  <TableCell>{m.supplierName}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(m.costCheck?.supplierCost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(m.costCheck?.cardCost)}</TableCell>
                  <TableCell>
                    {m.costCheck?.flagged ? (
                      <Badge variant="destructive" className="gap-1 whitespace-nowrap" data-testid={`supplier-price-flag-${m.id}`}>
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        {costCheckLabel(m.costCheck)}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">{costCheckLabel(m.costCheck)}</span>
                    )}
                  </TableCell>
                  <TableCell>{m.packSize}</TableCell>
                  <TableCell>
                    <Switch
                      checked={m.isPreferred === 1}
                      disabled={!canMutate}
                      onCheckedChange={() => togglePreferred.mutate(m)}
                    />
                  </TableCell>
                  {canMutate && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-destructive hover:text-destructive"
                        aria-label="Remove this product-supplier mapping"
                        onClick={() => deleteMapping.mutate(m.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        Remove
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={supplierOpen} onOpenChange={setSupplierOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSupplier ? "Edit supplier" : "New supplier"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Name *</Label>
              <Input
                value={supplierForm.name}
                onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Lead time (days)</Label>
                <Input
                  type="number"
                  min={0}
                  value={supplierForm.leadTimeDays}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, leadTimeDays: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>Min order value (£)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={supplierForm.minOrderValue}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, minOrderValue: e.target.value })
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => saveSupplier.mutate()} disabled={!supplierForm.name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mappingOpen} onOpenChange={setMappingOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supplier price for a product</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Product</Label>
              <Select
                value={mappingForm.productId}
                onValueChange={(v) => setMappingForm({ ...mappingForm, productId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.productId})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Supplier</Label>
              <Select
                value={mappingForm.supplierId}
                onValueChange={(v) => setMappingForm({ ...mappingForm, supplierId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {activeSuppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mapping-cost">Supplier price (£)</Label>
                <Input
                  id="mapping-cost"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={mappingForm.costPrice}
                  onChange={(e) => setMappingForm({ ...mappingForm, costPrice: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="mapping-sku">Supplier's code</Label>
                <Input
                  id="mapping-sku"
                  value={mappingForm.supplierSku}
                  onChange={(e) => setMappingForm({ ...mappingForm, supplierSku: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={mappingForm.isPreferred}
                onCheckedChange={(c) => setMappingForm({ ...mappingForm, isPreferred: c })}
              />
              <Label>Preferred supplier</Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => saveMapping.mutate()}
              disabled={!mappingForm.productId || !mappingForm.supplierId}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
