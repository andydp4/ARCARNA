import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Palette } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { OrgSetup } from "@shared/setup";

export function BrandingSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: org, isLoading } = useQuery<OrgSetup>({
    queryKey: ["/api/org/setup"],
  });

  const [form, setForm] = useState({
    logoUrl: "",
    receiptLogoEnabled: false,
    invoiceLogoEnabled: false,
    accentStyle: "arcarna",
    receiptFooter: "",
    invoicePrefix: "INV",
    invoiceStartNumber: 1000,
    paymentTerms: "",
    defaultTaxRate: "20",
    invoiceBankName: "",
    invoiceBankSortCode: "",
    invoiceBankAccountNumber: "",
    invoicePaymentLink: "",
  });

  useEffect(() => {
    if (!org) return;
    setForm({
      logoUrl: org.logoUrl ?? "",
      receiptLogoEnabled: org.receiptLogoEnabled ?? false,
      invoiceLogoEnabled: org.invoiceLogoEnabled ?? false,
      accentStyle: org.accentStyle ?? "arcarna",
      receiptFooter: org.receiptFooter ?? "",
      invoicePrefix: org.invoicePrefix ?? "INV",
      invoiceStartNumber: org.invoiceStartNumber ?? 1000,
      paymentTerms: org.paymentTerms ?? "",
      defaultTaxRate: String(org.defaultTaxRate ?? "20"),
      invoiceBankName: org.invoiceBankName ?? "",
      invoiceBankSortCode: org.invoiceBankSortCode ?? "",
      invoiceBankAccountNumber: org.invoiceBankAccountNumber ?? "",
      invoicePaymentLink: org.invoicePaymentLink ?? "",
    });
  }, [org]);

  const save = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/org/setup", form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/setup"] });
      toast({ title: "Branding updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update branding", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card className="border-0 shadow-none lm-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5" /> Branding
        </CardTitle>
        <CardDescription>Applies to receipts and invoices.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="space-y-2">
              <Label>Logo URL</Label>
              <Input
                value={form.logoUrl}
                onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                placeholder="https://..."
                className="min-h-[44px]"
                data-testid="branding-logo-url"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Show logo on receipts</p>
              </div>
              <Switch
                checked={form.receiptLogoEnabled}
                onCheckedChange={(v) => setForm({ ...form, receiptLogoEnabled: v })}
                data-testid="branding-receipt-logo-enabled"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Show logo on invoices</p>
              </div>
              <Switch
                checked={form.invoiceLogoEnabled}
                onCheckedChange={(v) => setForm({ ...form, invoiceLogoEnabled: v })}
                data-testid="branding-invoice-logo-enabled"
              />
            </div>
            <div className="space-y-2">
              <Label>Accent style</Label>
              <Input
                value={form.accentStyle}
                onChange={(e) => setForm({ ...form, accentStyle: e.target.value })}
                className="min-h-[44px]"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Invoice prefix</Label>
                <Input
                  value={form.invoicePrefix}
                  onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })}
                  className="min-h-[44px]"
                />
              </div>
              <div className="space-y-2">
                <Label>Invoice start number</Label>
                <Input
                  type="number"
                  value={form.invoiceStartNumber}
                  onChange={(e) => setForm({ ...form, invoiceStartNumber: Number(e.target.value) })}
                  className="min-h-[44px]"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Payment terms</Label>
              <Input
                value={form.paymentTerms}
                onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label>Default tax rate (%)</Label>
              <Input
                value={form.defaultTaxRate}
                onChange={(e) => setForm({ ...form, defaultTaxRate: e.target.value })}
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label>Receipt footer</Label>
              <Textarea
                value={form.receiptFooter}
                onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })}
              />
            </div>

            <div className="pt-2 border-t space-y-1">
              <p className="text-sm font-medium">Invoice payment details</p>
              <p className="text-xs text-muted-foreground">
                Shown on generated invoice PDFs. Leave blank to omit that section.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Bank name</Label>
                <Input
                  value={form.invoiceBankName}
                  onChange={(e) => setForm({ ...form, invoiceBankName: e.target.value })}
                  className="min-h-[44px]"
                  data-testid="branding-bank-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Sort code</Label>
                <Input
                  value={form.invoiceBankSortCode}
                  onChange={(e) => setForm({ ...form, invoiceBankSortCode: e.target.value })}
                  className="min-h-[44px]"
                  data-testid="branding-bank-sort-code"
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Account number</Label>
                <Input
                  value={form.invoiceBankAccountNumber}
                  onChange={(e) => setForm({ ...form, invoiceBankAccountNumber: e.target.value })}
                  className="min-h-[44px]"
                  data-testid="branding-bank-account-number"
                />
              </div>
              <div className="space-y-2">
                <Label>Online payment link</Label>
                <Input
                  value={form.invoicePaymentLink}
                  onChange={(e) => setForm({ ...form, invoicePaymentLink: e.target.value })}
                  placeholder="https://..."
                  className="min-h-[44px]"
                  data-testid="branding-payment-link"
                />
              </div>
            </div>

            <Button onClick={() => save.mutate()} disabled={save.isPending} className="min-h-[44px]" data-testid="button-save-branding">
              Save branding
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
