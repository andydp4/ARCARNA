import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Check,
  Package,
  Users,
  Palette,
  Wallet,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { apiRequest } from "@/lib/queryClient";
import { SpreadsheetImport } from "@/components/import/SpreadsheetImport";
import {
  BUSINESS_TYPES,
  SETUP_WIZARD_STEPS,
  COMMISSION_RATE_PRESETS,
  SHIFT_INACTIVITY_OPTIONS,
  type BusinessType,
  type OrgSetup,
  type SetupCashierDraft,
  type SetupWizardState,
  type SetupWizardStep,
} from "@shared/setup";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

const STEP_META = [
  { id: "business", label: "Business details", icon: Building2 },
  { id: "business-type", label: "Business type", icon: Building2 },
  { id: "import-products", label: "Import products", icon: Package },
  { id: "import-customers", label: "Import customers", icon: Users },
  { id: "branding", label: "Branding", icon: Palette },
  { id: "cashiers-and-commission", label: "Cashiers & commission", icon: Wallet },
  { id: "review", label: "Review & finish", icon: Check },
];

const SHIFT_INACTIVITY_LABELS: Record<(typeof SHIFT_INACTIVITY_OPTIONS)[number], string> = {
  "1_hour": "1 hour",
  "12_hours": "12 hours",
  "1_day": "1 day",
  never: "Never",
};

function emptyCashierDraft(): SetupCashierDraft {
  return { cashierCode: "", displayName: "", defaultCommissionRate: "" };
}

export default function SetupWizard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [stepIndex, setStepIndex] = useState(0);

  const { data: org, isLoading } = useQuery<OrgSetup>({
    queryKey: ["/api/org/setup"],
  });

  const [form, setForm] = useState({
    name: "",
    tradingName: "",
    email: "",
    phone: "",
    address: "",
    vatNumber: "",
    companyNumber: "",
    currency: "GBP",
    timezone: "Europe/London",
    businessType: "retail" as BusinessType,
    logoUrl: "",
    invoiceTemplate: "standard",
    invoicePrefix: "INV",
    invoiceStartNumber: 1000,
    paymentTerms: "Net 30",
    defaultTaxRate: "20",
    receiptFooter: "Thank you for your business",
    receiptStyle: "standard",
    accentStyle: "arcarna",
    businessColors: { primary: "#1e293b", accent: "#6366f1" },
    receiptLogoEnabled: false,
    invoiceLogoEnabled: false,
    invoiceBankName: "",
    invoiceBankSortCode: "",
    invoiceBankAccountNumber: "",
    invoicePaymentLink: "",
    cashierCommissionEnabled: false,
    defaultCashierCommissionRate: "10",
    requireCashierForSale: true,
    shiftInactivityCloseAfter: "never" as (typeof SHIFT_INACTIVITY_OPTIONS)[number],
  });

  const [cashierDrafts, setCashierDrafts] = useState<SetupCashierDraft[]>([emptyCashierDraft()]);

  useEffect(() => {
    if (!org) return;
    setForm((f) => ({
      ...f,
      name: org.name ?? f.name,
      tradingName: org.tradingName ?? f.tradingName,
      email: org.email ?? f.email,
      phone: org.phone ?? f.phone,
      address: org.address ?? f.address,
      vatNumber: org.vatNumber ?? f.vatNumber,
      companyNumber: org.companyNumber ?? f.companyNumber,
      currency: org.currency ?? f.currency,
      timezone: org.timezone ?? f.timezone,
      businessType: (org.businessType as BusinessType | null) ?? f.businessType,
      logoUrl: org.logoUrl ?? f.logoUrl,
      invoiceTemplate: org.invoiceTemplate ?? f.invoiceTemplate,
      invoicePrefix: org.invoicePrefix ?? f.invoicePrefix,
      invoiceStartNumber: org.invoiceStartNumber ?? f.invoiceStartNumber,
      paymentTerms: org.paymentTerms ?? f.paymentTerms,
      defaultTaxRate: String(org.defaultTaxRate ?? f.defaultTaxRate),
      receiptFooter: org.receiptFooter ?? f.receiptFooter,
      receiptStyle: org.receiptStyle ?? f.receiptStyle,
      accentStyle: org.accentStyle ?? f.accentStyle,
      businessColors:
        (org.businessColors as { primary: string; accent: string } | null) ?? f.businessColors,
      receiptLogoEnabled: org.receiptLogoEnabled ?? f.receiptLogoEnabled,
      invoiceLogoEnabled: org.invoiceLogoEnabled ?? f.invoiceLogoEnabled,
      invoiceBankName: org.invoiceBankName ?? f.invoiceBankName,
      invoiceBankSortCode: org.invoiceBankSortCode ?? f.invoiceBankSortCode,
      invoiceBankAccountNumber: org.invoiceBankAccountNumber ?? f.invoiceBankAccountNumber,
      invoicePaymentLink: org.invoicePaymentLink ?? f.invoicePaymentLink,
      cashierCommissionEnabled: org.cashierCommissionEnabled ?? f.cashierCommissionEnabled,
      defaultCashierCommissionRate: String(org.defaultCashierCommissionRate ?? f.defaultCashierCommissionRate),
      requireCashierForSale: org.requireCashierForSale ?? f.requireCashierForSale,
      shiftInactivityCloseAfter:
        (org.shiftInactivityCloseAfter as (typeof SHIFT_INACTIVITY_OPTIONS)[number] | null) ??
        f.shiftInactivityCloseAfter,
    }));
    const state = org.setupWizardState as SetupWizardState | null;
    if (state?.currentStep) {
      const step = state.currentStep as SetupWizardStep;
      const idx = SETUP_WIZARD_STEPS.indexOf(step);
      if (idx >= 0) setStepIndex(idx);
    }
  }, [org]);

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      await apiRequest("PATCH", "/api/org/setup", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/setup"] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/org/setup/complete", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Setup complete", description: "Your organization is ready." });
      setLocation("/");
    },
  });

  const createCashiersMutation = useMutation({
    mutationFn: async () => {
      if (!form.cashierCommissionEnabled) return;
      const valid = cashierDrafts.filter((d) => d.cashierCode.trim() && d.displayName.trim());
      for (const draft of valid) {
        await apiRequest("POST", "/api/cashiers", {
          cashierCode: draft.cashierCode.trim(),
          displayName: draft.displayName.trim(),
          defaultCommissionRate:
            draft.defaultCommissionRate != null && String(draft.defaultCommissionRate).trim() !== ""
              ? Number(draft.defaultCommissionRate)
              : undefined,
        });
      }
    },
  });

  const currentStep = SETUP_WIZARD_STEPS[stepIndex];
  const progress = ((stepIndex + 1) / SETUP_WIZARD_STEPS.length) * 100;

  const persistStep = async (nextIndex: number) => {
    const nextStep = SETUP_WIZARD_STEPS[nextIndex];
    await saveMutation.mutateAsync({
      ...form,
      name: form.tradingName || form.name,
      setupWizardState: {
        currentStep: nextStep,
        completedSteps: SETUP_WIZARD_STEPS.slice(0, stepIndex + 1),
        draft: form,
      },
    });
    setStepIndex(nextIndex);
  };

  useEffect(() => {
    if (user && !["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      setLocation("/setup-blocked");
    }
  }, [user, setLocation]);

  if (user && !["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen lm-auth-shell liquid-metal flex items-center justify-center">
        <div className="animate-spin h-10 w-10 border-b-2 border-primary rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen lm-auth-shell liquid-metal py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-metal-warm-white">Organization setup</h1>
          <p className="text-metal-muted text-sm mt-1">
            Step {stepIndex + 1} of {SETUP_WIZARD_STEPS.length}: {STEP_META[stepIndex]?.label}
          </p>
          <Progress value={progress} className="mt-4 h-2" />
        </div>

        <Card className="mb-6 lm-card border-0 shadow-none">
          <CardContent className="pt-6">
            {currentStep === "business" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Trading / business name</Label>
                  <Input
                    value={form.tradingName}
                    onChange={(e) => setForm({ ...form, tradingName: e.target.value, name: e.target.value })}
                    className="min-h-[44px]"
                    data-testid="wizard-trading-name"
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="min-h-[44px]" />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="min-h-[44px]" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Address</Label>
                  <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>VAT number</Label>
                    <Input value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} className="min-h-[44px]" />
                  </div>
                  <div className="space-y-2">
                    <Label>Company number</Label>
                    <Input value={form.companyNumber} onChange={(e) => setForm({ ...form, companyNumber: e.target.value })} className="min-h-[44px]" />
                  </div>
                </div>
              </div>
            )}

            {currentStep === "business-type" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Business type</Label>
                  <Select
                    value={form.businessType}
                    onValueChange={(v) => setForm({ ...form, businessType: v as BusinessType })}
                  >
                    <SelectTrigger className="min-h-[44px]" data-testid="wizard-business-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BUSINESS_TYPES.map((t: BusinessType) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Currency</Label>
                    <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="min-h-[44px]" />
                  </div>
                  <div className="space-y-2">
                    <Label>Timezone</Label>
                    <Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className="min-h-[44px]" />
                  </div>
                </div>
              </div>
            )}

            {currentStep === "import-products" && (
              <SpreadsheetImport
                kind="products"
                title="Import products (optional)"
                description="Upload CSV or XLSX. Duplicates skip by default."
                duplicateModes={["skip", "overwrite"]}
                defaultDuplicateMode="skip"
                fieldOptions={[
                  { key: "name", label: "Name *" },
                  { key: "productId", label: "SKU / Product ID" },
                  { key: "defaultSalePrice", label: "Sale price *" },
                  { key: "costPrice", label: "Cost price" },
                  { key: "stock", label: "Stock" },
                  { key: "barcode", label: "Barcode" },
                ]}
              />
            )}

            {currentStep === "import-customers" && (
              <SpreadsheetImport
                kind="customers"
                title="Import customers (optional)"
                description="Upload CSV or XLSX. Match by email or phone."
                duplicateModes={["skip", "merge", "overwrite"]}
                defaultDuplicateMode="skip"
                fieldOptions={[
                  { key: "name", label: "Name *" },
                  { key: "email", label: "Email" },
                  { key: "phone", label: "Phone" },
                  { key: "address", label: "Address" },
                  { key: "category", label: "Category" },
                ]}
              />
            )}

            {currentStep === "branding" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Logo URL</Label>
                  <Input value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://..." className="min-h-[44px]" />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Invoice prefix</Label>
                    <Input value={form.invoicePrefix} onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })} className="min-h-[44px]" />
                  </div>
                  <div className="space-y-2">
                    <Label>Start number</Label>
                    <Input type="number" value={form.invoiceStartNumber} onChange={(e) => setForm({ ...form, invoiceStartNumber: Number(e.target.value) })} className="min-h-[44px]" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Payment terms</Label>
                  <Input value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} className="min-h-[44px]" />
                </div>
                <div className="space-y-2">
                  <Label>Default tax rate (%)</Label>
                  <Input value={form.defaultTaxRate} onChange={(e) => setForm({ ...form, defaultTaxRate: e.target.value })} className="min-h-[44px]" />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Receipt style</Label>
                    <Input value={form.receiptStyle} onChange={(e) => setForm({ ...form, receiptStyle: e.target.value })} className="min-h-[44px]" />
                  </div>
                  <div className="space-y-2">
                    <Label>Accent style</Label>
                    <Input value={form.accentStyle} onChange={(e) => setForm({ ...form, accentStyle: e.target.value })} className="min-h-[44px]" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Receipt footer</Label>
                  <Textarea value={form.receiptFooter} onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })} />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">Show logo on receipts</p>
                    <p className="text-xs text-muted-foreground">Print your logo at the top of printed/emailed receipts.</p>
                  </div>
                  <Switch
                    checked={form.receiptLogoEnabled}
                    onCheckedChange={(v) => setForm({ ...form, receiptLogoEnabled: v })}
                    data-testid="wizard-receipt-logo-enabled"
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">Show logo on invoices</p>
                    <p className="text-xs text-muted-foreground">Include your logo on generated invoices.</p>
                  </div>
                  <Switch
                    checked={form.invoiceLogoEnabled}
                    onCheckedChange={(v) => setForm({ ...form, invoiceLogoEnabled: v })}
                    data-testid="wizard-invoice-logo-enabled"
                  />
                </div>
                <div className="pt-2 border-t space-y-1">
                  <p className="text-sm font-medium">Invoice payment details (optional)</p>
                  <p className="text-xs text-muted-foreground">
                    Shown on generated invoice PDFs. Leave blank to omit — you can add these later in Settings.
                  </p>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Bank name</Label>
                    <Input value={form.invoiceBankName} onChange={(e) => setForm({ ...form, invoiceBankName: e.target.value })} className="min-h-[44px]" />
                  </div>
                  <div className="space-y-2">
                    <Label>Sort code</Label>
                    <Input value={form.invoiceBankSortCode} onChange={(e) => setForm({ ...form, invoiceBankSortCode: e.target.value })} className="min-h-[44px]" />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Account number</Label>
                    <Input value={form.invoiceBankAccountNumber} onChange={(e) => setForm({ ...form, invoiceBankAccountNumber: e.target.value })} className="min-h-[44px]" />
                  </div>
                  <div className="space-y-2">
                    <Label>Online payment link</Label>
                    <Input value={form.invoicePaymentLink} onChange={(e) => setForm({ ...form, invoicePaymentLink: e.target.value })} placeholder="https://..." className="min-h-[44px]" />
                  </div>
                </div>
              </div>
            )}

            {currentStep === "cashiers-and-commission" && (
              <div className="space-y-5">
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">Enable cashier commission</p>
                    <p className="text-xs text-muted-foreground">
                      Track cashier shifts and pay commission on shift profit.
                    </p>
                  </div>
                  <Switch
                    checked={form.cashierCommissionEnabled}
                    onCheckedChange={(v) => setForm({ ...form, cashierCommissionEnabled: v })}
                    data-testid="wizard-cashier-commission-enabled"
                  />
                </div>

                {form.cashierCommissionEnabled && (
                  <>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Default commission rate</Label>
                        <Select
                          value={form.defaultCashierCommissionRate}
                          onValueChange={(v) => setForm({ ...form, defaultCashierCommissionRate: v })}
                        >
                          <SelectTrigger className="min-h-[44px]" data-testid="wizard-commission-rate">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {COMMISSION_RATE_PRESETS.map((rate) => (
                              <SelectItem key={rate} value={String(rate)}>{rate}%</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Auto-close inactive shift after</Label>
                        <Select
                          value={form.shiftInactivityCloseAfter}
                          onValueChange={(v) =>
                            setForm({ ...form, shiftInactivityCloseAfter: v as (typeof SHIFT_INACTIVITY_OPTIONS)[number] })
                          }
                        >
                          <SelectTrigger className="min-h-[44px]" data-testid="wizard-shift-auto-close">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SHIFT_INACTIVITY_OPTIONS.map((opt) => (
                              <SelectItem key={opt} value={opt}>{SHIFT_INACTIVITY_LABELS[opt]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <p className="text-sm font-medium">Require active cashier shift before sale</p>
                        <p className="text-xs text-muted-foreground">
                          Block checkout until a cashier starts a shift.
                        </p>
                      </div>
                      <Switch
                        checked={form.requireCashierForSale}
                        onCheckedChange={(v) => setForm({ ...form, requireCashierForSale: v })}
                        data-testid="wizard-require-cashier-for-sale"
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Cashier profiles</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-[44px]"
                          onClick={() => setCashierDrafts((d) => [...d, emptyCashierDraft()])}
                          data-testid="wizard-add-cashier"
                        >
                          <Plus className="mr-1 h-4 w-4" /> Add cashier
                        </Button>
                      </div>
                      {cashierDrafts.map((draft, idx) => (
                        <div key={idx} className="grid sm:grid-cols-[1fr_2fr_1fr_auto] gap-2 items-end rounded-md border p-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Cashier code</Label>
                            <Input
                              value={draft.cashierCode}
                              placeholder="001"
                              className="min-h-[44px]"
                              onChange={(e) => {
                                const next = [...cashierDrafts];
                                next[idx] = { ...next[idx], cashierCode: e.target.value };
                                setCashierDrafts(next);
                              }}
                              data-testid={`wizard-cashier-code-${idx}`}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Display name</Label>
                            <Input
                              value={draft.displayName}
                              placeholder="Jordan"
                              className="min-h-[44px]"
                              onChange={(e) => {
                                const next = [...cashierDrafts];
                                next[idx] = { ...next[idx], displayName: e.target.value };
                                setCashierDrafts(next);
                              }}
                              data-testid={`wizard-cashier-name-${idx}`}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Commission override</Label>
                            <Input
                              value={draft.defaultCommissionRate ?? ""}
                              placeholder="Default"
                              className="min-h-[44px]"
                              onChange={(e) => {
                                const next = [...cashierDrafts];
                                next[idx] = { ...next[idx], defaultCommissionRate: e.target.value };
                                setCashierDrafts(next);
                              }}
                              data-testid={`wizard-cashier-rate-${idx}`}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="min-h-[44px] min-w-[44px]"
                            disabled={cashierDrafts.length === 1}
                            onClick={() => setCashierDrafts((d) => d.filter((_, i) => i !== idx))}
                            aria-label="Remove cashier"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {currentStep === "review" && (
              <div className="space-y-3 text-sm">
                <p><strong>Business:</strong> {form.tradingName}</p>
                <p><strong>Type:</strong> {form.businessType}</p>
                <p><strong>Currency:</strong> {form.currency} · {form.timezone}</p>
                <p><strong>Invoices:</strong> {form.invoicePrefix}-{form.invoiceStartNumber}</p>
                <p><strong>Branding:</strong> Logo {form.logoUrl ? "set" : "not set"} · Receipt logo {form.receiptLogoEnabled ? "on" : "off"} · Invoice logo {form.invoiceLogoEnabled ? "on" : "off"}</p>
                <p><strong>Invoice payment details:</strong> {form.invoiceBankName || form.invoiceBankAccountNumber || form.invoicePaymentLink ? "Set" : "Not set"}</p>
                <p>
                  <strong>Cashier commission:</strong>{" "}
                  {form.cashierCommissionEnabled
                    ? `Enabled · ${form.defaultCashierCommissionRate}% default · auto-close ${SHIFT_INACTIVITY_LABELS[form.shiftInactivityCloseAfter]} · ${form.requireCashierForSale ? "shift required for sale" : "shift optional"}`
                    : "Disabled"}
                </p>
                {form.cashierCommissionEnabled && (
                  <p>
                    <strong>Cashier profiles:</strong>{" "}
                    {cashierDrafts.filter((d) => d.cashierCode.trim() && d.displayName.trim()).length
                      ? cashierDrafts
                          .filter((d) => d.cashierCode.trim() && d.displayName.trim())
                          .map((d) => `${d.cashierCode} (${d.displayName})`)
                          .join(", ")
                      : "None added yet"}
                  </p>
                )}
                <p className="text-muted-foreground">You can change these later in Settings.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-between gap-3">
          <Button
            variant="outline"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            className="min-h-[44px]"
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          {currentStep === "review" ? (
            <Button
              onClick={() => {
                saveMutation.mutate(form, {
                  onSuccess: () => {
                    createCashiersMutation.mutate(undefined, {
                      onSuccess: () => completeMutation.mutate(),
                      onError: () => completeMutation.mutate(),
                    });
                  },
                });
              }}
              disabled={completeMutation.isPending || createCashiersMutation.isPending}
              className="min-h-[44px]"
              data-testid="wizard-finish"
            >
              Finish setup
            </Button>
          ) : (
            <Button
              onClick={() => persistStep(stepIndex + 1)}
              disabled={saveMutation.isPending || (currentStep === "business" && !form.tradingName.trim())}
              className="min-h-[44px]"
              data-testid="wizard-next"
            >
              Save & continue <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
