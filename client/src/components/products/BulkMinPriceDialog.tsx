/**
 * Bulk "Set minimum price" (v1.2 Phase 4, PRC-05): managers and admins.
 *
 * Pick a rule — follow the sale price, sale price −x%, cost +x%, or a fixed
 * £ — see the preview (old and new minimum per product, and what is skipped
 * and why), then apply. The server runs the same rule again on the rows it
 * locks, writes every change to price history, and tells the owner when a
 * manager makes the change.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  BULK_MIN_RULE_LABELS,
  BULK_MIN_RULES,
  bulkMinSkipLabel,
  type BulkMinPreviewRow,
  type BulkMinRule,
  type BulkMinRuleKind,
} from "@shared/pricing/bulkMinPrice";

function ruleOf(kind: BulkMinRuleKind, value: string): BulkMinRule | null {
  if (kind === "follow") return { kind };
  const n = Number(value);
  if (value.trim() === "" || !Number.isFinite(n) || n < 0) return null;
  if (kind === "fixed") return { kind, amount: n };
  if (kind === "sale_minus_pct" && n > 100) return null;
  return { kind, percent: n };
}

const fmt = (n: number | null) => (n == null ? "Follows price" : `£${n.toFixed(2)}`);

export function BulkMinPriceDialog({
  open,
  productIds,
  onClose,
  onApplied,
}: {
  open: boolean;
  productIds: string[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState<BulkMinRuleKind>("sale_minus_pct");
  const [value, setValue] = useState("10");
  const [preview, setPreview] = useState<BulkMinPreviewRow[] | null>(null);
  const rule = ruleOf(kind, value);

  const previewMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/products/min-price/preview", { productIds, rule })).json(),
    onSuccess: (r: { rows: BulkMinPreviewRow[] }) => setPreview(r.rows),
    onError: (e: Error) => toast({ title: "Could not preview", description: e.message, variant: "destructive" }),
  });
  const applyMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/products/min-price/apply", { productIds, rule })).json(),
    onSuccess: (r: { changed: number; skipped: number }) => {
      toast({
        title: "Minimum prices set",
        description: `${r.changed} changed${r.skipped ? `, ${r.skipped} skipped` : ""}. Each change is in the product's price history.`,
      });
      setPreview(null);
      onApplied();
    },
    onError: (e: Error) => toast({ title: "Could not set the minimum prices", description: e.message, variant: "destructive" }),
  });

  const changes = preview?.filter((r) => r.changed).length ?? 0;
  const reset = () => setPreview(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl" data-testid="dialog-bulk-min-price">
        <DialogHeader>
          <DialogTitle>Set minimum price</DialogTitle>
          <DialogDescription>
            For {productIds.length} selected product{productIds.length === 1 ? "" : "s"}. Preview first; nothing changes until you apply.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Rule</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v as BulkMinRuleKind);
                reset();
              }}
            >
              <SelectTrigger className="w-[220px] min-h-[44px]" data-testid="select-bulk-min-rule">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BULK_MIN_RULES.map((k) => (
                  <SelectItem key={k} value={k}>
                    {BULK_MIN_RULE_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {kind !== "follow" && (
            <div className="space-y-1">
              <Label htmlFor="bulk-min-value" className="text-xs">
                {kind === "fixed" ? "£" : "%"}
              </Label>
              <Input
                id="bulk-min-value"
                type="number"
                min={0}
                step={kind === "fixed" ? "0.01" : "1"}
                inputMode="decimal"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  reset();
                }}
                className="w-[120px] min-h-[44px]"
                data-testid="input-bulk-min-value"
              />
            </div>
          )}
          <Button
            variant="outline"
            className="min-h-[44px]"
            disabled={!rule || previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
            data-testid="button-bulk-min-preview"
          >
            Preview
          </Button>
        </div>
        {preview && (
          <div className="max-h-[320px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Sale price</TableHead>
                  <TableHead className="text-right">Min now</TableHead>
                  <TableHead className="text-right">New min</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((r) => (
                  <TableRow key={r.productId} className={r.skipped ? "text-muted-foreground" : undefined}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right">£{r.salePrice.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{fmt(r.oldMin)}</TableCell>
                    <TableCell className="text-right">
                      {r.skipped ? `Skipped: ${bulkMinSkipLabel(r.skipped)}` : r.changed ? fmt(r.newMin) : "No change"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!preview || changes === 0 || applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
            className="min-h-[44px]"
            data-testid="button-bulk-min-apply"
          >
            Apply to {changes} product{changes === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
