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
import { apiRequest } from "@/lib/queryClient";
import { SpreadsheetImport } from "@/components/import/SpreadsheetImport";
import {
  BUSINESS_TYPES,
  SETUP_WIZARD_STEPS,
  type BusinessType,
  type OrgSetup,
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
  { id: "review", label: "Review & finish", icon: Check },
];

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
    accentStyle: "midnight",
    businessColors: { primary: "#1e293b", accent: "#6366f1" },
  });

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
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-10 w-10 border-b-2 border-primary rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Organization setup</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Step {stepIndex + 1} of {SETUP_WIZARD_STEPS.length}: {STEP_META[stepIndex]?.label}
          </p>
          <Progress value={progress} className="mt-4 h-2" />
        </div>

        <Card className="mb-6">
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
              </div>
            )}

            {currentStep === "review" && (
              <div className="space-y-3 text-sm">
                <p><strong>Business:</strong> {form.tradingName}</p>
                <p><strong>Type:</strong> {form.businessType}</p>
                <p><strong>Currency:</strong> {form.currency} · {form.timezone}</p>
                <p><strong>Invoices:</strong> {form.invoicePrefix}-{form.invoiceStartNumber}</p>
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
                  onSuccess: () => completeMutation.mutate(),
                });
              }}
              disabled={completeMutation.isPending}
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
