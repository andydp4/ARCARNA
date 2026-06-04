import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Building2, Coins, MapPin, Package, ShoppingCart, Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { CURRENCY_PRESETS, ONBOARDING_STEPS, type OnboardingStepId } from "@shared/onboarding";
import { useToast } from "@/hooks/use-toast";

const STEP_META: Record<OnboardingStepId, { label: string; icon: typeof Building2 }> = {
  org: { label: "Business details", icon: Building2 },
  currency: { label: "Currency", icon: Coins },
  location: { label: "First location", icon: MapPin },
  product: { label: "First product", icon: Package },
  "first-sale": { label: "Test sale", icon: ShoppingCart },
};

type OnboardingApi = {
  nextStep: OnboardingStepId | "done";
  completedCount: number;
  totalSteps: number;
  isComplete: boolean;
};

export default function OnboardingWizard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const { data, isLoading } = useQuery<OnboardingApi>({
    queryKey: ["/api/onboarding"],
  });

  const [orgForm, setOrgForm] = useState({ name: "", timezone: "Europe/London", logoUrl: "" });
  const [currency, setCurrency] = useState("GBP");
  const [locationName, setLocationName] = useState("Main store");
  const [productForm, setProductForm] = useState({
    name: "Starter product",
    productCode: "SKU-001",
    defaultSalePrice: "1.00",
  });

  const patchStep = useMutation({
    mutationFn: async (body: { step: OnboardingStepId; completed: boolean; draft?: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", "/api/onboarding/step", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  const completeFirstSale = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/onboarding/complete-first-sale", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  const activeStep = data?.nextStep === "done" ? "done" : (data?.nextStep ?? "org");
  const progressPct = data ? (data.completedCount / data.totalSteps) * 100 : 0;

  useEffect(() => {
    if (data?.isComplete) setLocation("/");
  }, [data?.isComplete, setLocation]);

  useEffect(() => {
    if (user?.orgName) setOrgForm((f) => ({ ...f, name: user.orgName ?? f.name }));
  }, [user?.orgName]);

  const saveOrg = async () => {
    await apiRequest("PATCH", "/api/org/setup", {
      name: orgForm.name.trim(),
      timezone: orgForm.timezone,
      logoUrl: orgForm.logoUrl.trim() || null,
    });
    await patchStep.mutateAsync({ step: "org", completed: true, draft: orgForm });
    toast({ title: "Business details saved" });
  };

  const saveCurrency = async () => {
    await apiRequest("PATCH", "/api/org/setup", { currency });
    await patchStep.mutateAsync({ step: "currency", completed: true, draft: { currency } });
    toast({ title: "Currency set" });
  };

  const saveLocation = async () => {
    await apiRequest("POST", "/api/locations", {
      name: locationName.trim(),
      isDefault: true,
      address: "",
    });
    await patchStep.mutateAsync({ step: "location", completed: true });
    toast({ title: "Location created" });
  };

  const saveProduct = async () => {
    await apiRequest("POST", "/api/products", {
      name: productForm.name.trim(),
      productCode: productForm.productCode.trim(),
      defaultSalePrice: productForm.defaultSalePrice,
      costPrice: "0",
      stock: 10,
    });
    await patchStep.mutateAsync({ step: "product", completed: true });
    toast({ title: "Product added" });
  };

  const finishFirstSale = async () => {
    await completeFirstSale.mutateAsync();
    await patchStep.mutateAsync({ step: "first-sale", completed: true });
    toast({
      title: "Setup complete",
      description: "Your £0.01 test sale is recorded. Open POS anytime for real sales.",
    });
    setLocation("/");
  };

  if (isLoading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    );
  }

  if (activeStep === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-slate-900 to-slate-800">
        <Card className="w-full max-w-lg text-center">
          <CardHeader>
            <Check className="mx-auto h-12 w-12 text-emerald-500 mb-2" />
            <CardTitle>You&apos;re ready to trade</CardTitle>
            <CardDescription>All setup steps are complete.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button asChild className="min-h-[44px]">
              <Link href="/pos">Open POS</Link>
            </Button>
            <Button asChild variant="outline" className="min-h-[44px]">
              <Link href="/">Go to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const StepIcon = STEP_META[activeStep].icon;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 py-8 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        <div>
          <p className="text-sm text-slate-400 mb-2">
            Step {data.completedCount + 1} of {data.totalSteps}
          </p>
          <Progress value={progressPct} className="h-2" />
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <StepIcon className="h-8 w-8 text-primary" />
              <div>
                <CardTitle>{STEP_META[activeStep].label}</CardTitle>
                <CardDescription>Progress is saved automatically.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeStep === "org" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="ob-name">Business name</Label>
                  <Input
                    id="ob-name"
                    value={orgForm.name}
                    onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                    className="min-h-[44px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-tz">Timezone</Label>
                  <Input
                    id="ob-tz"
                    value={orgForm.timezone}
                    onChange={(e) => setOrgForm({ ...orgForm, timezone: e.target.value })}
                    className="min-h-[44px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-logo">Logo URL (optional)</Label>
                  <Input
                    id="ob-logo"
                    value={orgForm.logoUrl}
                    onChange={(e) => setOrgForm({ ...orgForm, logoUrl: e.target.value })}
                    placeholder="https://..."
                    className="min-h-[44px]"
                  />
                </div>
                <Button className="w-full min-h-[44px]" disabled={!orgForm.name.trim() || patchStep.isPending} onClick={() => void saveOrg()}>
                  Continue
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </>
            )}

            {activeStep === "currency" && (
              <>
                <div className="space-y-2">
                  <Label>Shop currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="min-h-[44px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCY_PRESETS.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.symbol} {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full min-h-[44px]" disabled={patchStep.isPending} onClick={() => void saveCurrency()}>
                  Continue
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </>
            )}

            {activeStep === "location" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="ob-loc">Location name</Label>
                  <Input
                    id="ob-loc"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    className="min-h-[44px]"
                  />
                </div>
                <Button
                  className="w-full min-h-[44px]"
                  disabled={!locationName.trim() || patchStep.isPending}
                  onClick={() => void saveLocation()}
                >
                  Create location
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </>
            )}

            {activeStep === "product" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="ob-prod">Product name</Label>
                  <Input
                    id="ob-prod"
                    value={productForm.name}
                    onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                    className="min-h-[44px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-sku">SKU / code</Label>
                  <Input
                    id="ob-sku"
                    value={productForm.productCode}
                    onChange={(e) => setProductForm({ ...productForm, productCode: e.target.value })}
                    className="min-h-[44px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-price">Sale price</Label>
                  <Input
                    id="ob-price"
                    value={productForm.defaultSalePrice}
                    onChange={(e) => setProductForm({ ...productForm, defaultSalePrice: e.target.value })}
                    className="min-h-[44px]"
                  />
                </div>
                <Button className="w-full min-h-[44px]" disabled={patchStep.isPending} onClick={() => void saveProduct()}>
                  Add product
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </>
            )}

            {activeStep === "first-sale" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Confirm a practice checkout. On production POS you can sell the product you just created; we mark this step
                  complete so you can open the till.
                </p>
                <Button
                  className="w-full min-h-[44px]"
                  disabled={completeFirstSale.isPending}
                  onClick={() => void finishFirstSale()}
                >
                  Complete test sale step
                  <Check className="ml-2 h-4 w-4" />
                </Button>
                <Button asChild variant="outline" className="w-full min-h-[44px]">
                  <Link href="/pos">Open POS instead</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
