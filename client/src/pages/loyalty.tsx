import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Award, Crown, Star, Plus, Edit2, Trash2, Users, TrendingUp, Gift } from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertLoyaltyTierSchema } from "@shared/schema";
import { Skeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";

// Extend the shared schema with form-specific validation
const tierFormSchema = insertLoyaltyTierSchema.extend({
  pointsRequired: z.coerce.number().min(0, "Points must be 0 or greater"),
  discountPercentage: z.string().transform(v => v.toString()),
  pointsMultiplier: z.string().transform(v => v.toString()),
  color: z.string().regex(/^#[0-9A-F]{6}$/i, "Must be a valid hex color").optional().default("#808080"),
});

type TierFormValues = {
  name: string;
  pointsRequired: number;
  discountPercentage: string;
  pointsMultiplier: string;
  color?: string;
  benefits?: string | null;
};

export default function LoyaltyPage() {
  const { toast } = useToast();
  const [editingTier, setEditingTier] = useState<any>(null);
  const [showTierDialog, setShowTierDialog] = useState(false);

  // Fetch loyalty tiers
  const { data: tiers = [], isLoading: tiersLoading } = useQuery({
    queryKey: ["/api/loyalty-tiers"],
  });

  // Fetch customers with loyalty data
  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ["/api/customers"],
  });

  // Create/Update tier
  const tierMutation = useMutation({
    mutationFn: async (data: TierFormValues) => {
      if (editingTier) {
        const response = await apiRequest("PATCH", `/api/loyalty-tiers/${editingTier.id}`, data);
        return response.json();
      }
      const response = await apiRequest("POST", "/api/loyalty-tiers", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loyalty-tiers"] });
      toast({
        title: editingTier ? "Tier updated" : "Tier created",
        description: "Loyalty tier has been saved successfully.",
      });
      setShowTierDialog(false);
      setEditingTier(null);
      tierForm.reset();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save loyalty tier.",
        variant: "destructive",
      });
    },
  });

  // Delete tier
  const deleteTier = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/loyalty-tiers/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loyalty-tiers"] });
      toast({
        title: "Tier deleted",
        description: "Loyalty tier has been removed.",
      });
    },
  });

  const tierForm = useForm<TierFormValues>({
    resolver: zodResolver(tierFormSchema),
    defaultValues: {
      name: "",
      pointsRequired: 0,
      discountPercentage: "0",
      pointsMultiplier: "1",
      color: "#808080",
      benefits: "",
    },
  });

  const openTierDialog = (tier?: any) => {
    if (tier) {
      tierForm.reset({
        name: tier.name,
        pointsRequired: tier.pointsRequired,
        discountPercentage: String(tier.discountPercentage || 0),
        pointsMultiplier: String(tier.pointsMultiplier || 1),
        color: tier.color || "#808080",
        benefits: tier.benefits || "",
      });
      setEditingTier(tier);
    } else {
      tierForm.reset();
      setEditingTier(null);
    }
    setShowTierDialog(true);
  };

  // Get tier for customer based on points
  const getCustomerTier = (points: number) => {
    const sortedTiers = [...(tiers as any[])].sort((a: any, b: any) => b.pointsRequired - a.pointsRequired);
    return sortedTiers.find((tier: any) => points >= tier.pointsRequired);
  };

  // Calculate tier statistics
  const tierStats = (tiers as any[]).map((tier: any) => {
    const count = (customers as any[]).filter((c: any) => {
      const customerTier = getCustomerTier(c.loyaltyPoints || 0);
      return customerTier?.id === tier.id;
    }).length;
    return { ...tier, customerCount: count };
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl sm:text-3xl font-bold">Loyalty Program</h1>
        <Button onClick={() => openTierDialog()} className="min-h-[44px] w-full sm:w-auto" data-testid="button-add-tier">
          <Plus className="mr-2 h-4 w-4" />
          Add Tier
        </Button>
      </div>

      <Tabs defaultValue="tiers" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="tiers" className="min-h-[44px]" data-testid="tab-tiers">
            <Crown className="mr-2 h-4 w-4" />
            Loyalty Tiers
          </TabsTrigger>
          <TabsTrigger value="customers" className="min-h-[44px]" data-testid="tab-customers">
            <Users className="mr-2 h-4 w-4" />
            Customer Status
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tiers" className="space-y-4">
          {/* Tier Overview Cards */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Tiers</CardTitle>
                <Award className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-tiers">{(tiers as any[]).length}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Members</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-active-members">
                  {(customers as any[]).filter((c: any) => c.loyaltyPoints > 0).length}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Points</CardTitle>
                <Star className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-points">
                  {(customers as any[]).reduce((sum: number, c: any) => sum + (c.loyaltyPoints || 0), 0).toLocaleString()}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Points</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-avg-points">
                  {(customers as any[]).length > 0
                    ? Math.round((customers as any[]).reduce((sum: number, c: any) => sum + (c.loyaltyPoints || 0), 0) / (customers as any[]).length)
                    : 0}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tier List */}
          {tiersLoading ? (
            <Skeleton count={3} variant="card" />
          ) : (tiers as any[]).length === 0 ? (
            <EmptyState
              icon={Crown}
              title="No loyalty tiers yet"
              body="Define tiers with point thresholds and rewards so customers can level up."
              cta={{
                label: "Add tier",
                onClick: () => openTierDialog(),
              }}
            />
          ) : (
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {tierStats
                .sort((a: any, b: any) => a.pointsRequired - b.pointsRequired)
                .map((tier: any) => (
                  <Card key={tier.id} data-testid={`card-tier-${tier.id}`}>
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-6 w-6 rounded-full"
                            style={{ backgroundColor: tier.color }}
                          />
                          <CardTitle>{tier.name}</CardTitle>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openTierDialog(tier)}
                            data-testid={`button-edit-tier-${tier.id}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteTier.mutate(tier.id)}
                            data-testid={`button-delete-tier-${tier.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Points Required</span>
                        <span className="font-semibold" data-testid={`text-points-${tier.id}`}>
                          {tier.pointsRequired}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Discount</span>
                        <span className="font-semibold" data-testid={`text-discount-${tier.id}`}>
                          {tier.discountPercentage}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Points Multiplier</span>
                        <span className="font-semibold" data-testid={`text-multiplier-${tier.id}`}>
                          {tier.pointsMultiplier}x
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Members</span>
                        <Badge data-testid={`badge-members-${tier.id}`}>
                          {tier.customerCount}
                        </Badge>
                      </div>
                      {tier.benefits && (
                        <div className="pt-2 text-sm text-muted-foreground">
                          {tier.benefits}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="customers" className="space-y-4">
          {customersLoading || tiersLoading ? (
            <Skeleton count={6} variant="row" />
          ) : (customers as any[]).filter((c: any) => c.loyaltyPoints > 0).length === 0 ? (
            <EmptyState
              icon={Users}
              title="No loyalty members yet"
              body="Customers earn points when they shop. Members with points will appear here."
              cta={{ label: "View customers", href: "/customers" }}
            />
          ) : (
            <div className="rounded-md border">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-4 text-left">Customer</th>
                    <th className="p-4 text-left">Tier</th>
                    <th className="p-4 text-center">Points</th>
                    <th className="p-4 text-center">Total Spent</th>
                    <th className="p-4 text-center">Next Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {(customers as any[])
                    .filter((c: any) => c.loyaltyPoints > 0)
                    .sort((a: any, b: any) => b.loyaltyPoints - a.loyaltyPoints)
                    .map((customer: any) => {
                      const currentTier = getCustomerTier(customer.loyaltyPoints || 0);
                      const nextTier = (tiers as any[])
                        .filter((t: any) => t.pointsRequired > (customer.loyaltyPoints || 0))
                        .sort((a: any, b: any) => a.pointsRequired - b.pointsRequired)[0];

                      return (
                        <tr key={customer.id} className="border-b" data-testid={`row-customer-${customer.id}`}>
                          <td className="p-4">
                            <div>
                              <div className="font-medium" data-testid={`text-customer-name-${customer.id}`}>
                                {customer.name}
                              </div>
                              {customer.email && (
                                <div className="text-sm text-muted-foreground">{customer.email}</div>
                              )}
                            </div>
                          </td>
                          <td className="p-4">
                            {currentTier ? (
                              <Badge
                                style={{
                                  backgroundColor: currentTier.color + "20",
                                  color: currentTier.color,
                                  borderColor: currentTier.color,
                                }}
                                data-testid={`badge-tier-${customer.id}`}
                              >
                                {currentTier.name}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">No tier</span>
                            )}
                          </td>
                          <td className="p-4 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Star className="h-4 w-4 text-yellow-500" />
                              <span className="font-semibold" data-testid={`text-points-${customer.id}`}>
                                {customer.loyaltyPoints || 0}
                              </span>
                            </div>
                          </td>
                          <td className="p-4 text-center" data-testid={`text-spent-${customer.id}`}>
                            ${(parseFloat(customer.totalSpent as any) || 0).toFixed(2)}
                          </td>
                          <td className="p-4 text-center">
                            {nextTier && (
                              <div className="text-sm">
                                <div className="text-muted-foreground">
                                  {nextTier.pointsRequired - (customer.loyaltyPoints || 0)} pts to
                                </div>
                                <div className="font-medium">{nextTier.name}</div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {(customers as any[]).filter((c: any) => c.loyaltyPoints > 0).length === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  No customers with loyalty points yet
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Tier Dialog */}
      <Dialog open={showTierDialog} onOpenChange={setShowTierDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTier ? "Edit Loyalty Tier" : "Create Loyalty Tier"}</DialogTitle>
          </DialogHeader>
          <Form {...tierForm}>
            <form onSubmit={tierForm.handleSubmit((data) => tierMutation.mutate(data))} className="space-y-4">
              <FormField
                control={tierForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tier Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Gold, Platinum" data-testid="input-tier-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={tierForm.control}
                  name="pointsRequired"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Points Required</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          type="number" 
                          onChange={(e) => field.onChange(parseInt(e.target.value))}
                          data-testid="input-points-required"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={tierForm.control}
                  name="discountPercentage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Discount %</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          type="number" 
                          step="0.01"
                          onChange={(e) => field.onChange(parseFloat(e.target.value))}
                          data-testid="input-discount"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={tierForm.control}
                  name="pointsMultiplier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Points Multiplier</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          type="number" 
                          step="0.01"
                          onChange={(e) => field.onChange(parseFloat(e.target.value))}
                          data-testid="input-multiplier"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={tierForm.control}
                  name="color"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Color</FormLabel>
                      <FormControl>
                        <Input {...field} type="color" data-testid="input-color" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={tierForm.control}
                name="benefits"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Benefits (Optional)</FormLabel>
                    <FormControl>
                      <Input 
                        {...field}
                        value={field.value || ""}
                        placeholder="e.g., Free shipping, Early access"
                        data-testid="input-benefits"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowTierDialog(false)}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={tierMutation.isPending} data-testid="button-save-tier">
                  {tierMutation.isPending ? "Saving..." : "Save Tier"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}