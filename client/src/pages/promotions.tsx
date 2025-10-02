import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Gift, Plus, Edit2, Trash2, Calendar, Percent, DollarSign, Tag, Clock, Users } from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { insertPromotionSchema } from "@shared/schema";

// Extend the shared schema with form-specific validation
const promoFormSchema = insertPromotionSchema.extend({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required").toUpperCase().optional(),
  type: z.enum(["percentage", "fixed", "bogo", "points"]),
  value: z.coerce.number().min(0, "Value must be 0 or greater").transform(v => String(v)),
  minPurchase: z.coerce.number().min(0).optional().transform(v => v ? String(v) : undefined),
  maxDiscount: z.coerce.number().min(0).optional().transform(v => v ? String(v) : undefined),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  usageLimit: z.coerce.number().min(1).optional(),
  isActive: z.boolean(),
});

type PromoFormValues = z.infer<typeof promoFormSchema>;

export default function PromotionsPage() {
  const { toast } = useToast();
  const [editingPromo, setEditingPromo] = useState<any>(null);
  const [showPromoDialog, setShowPromoDialog] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "expired">("all");

  // Fetch promotions
  const { data: promotions = [], isLoading } = useQuery({
    queryKey: ["/api/promotions"],
  });

  // Create/Update promotion
  const promoMutation = useMutation({
    mutationFn: async (data: PromoFormValues) => {
      const formattedData = {
        ...data,
        startDate: new Date(data.startDate).toISOString(),
        endDate: new Date(data.endDate).toISOString(),
        isActive: data.isActive ? 1 : 0,
      };

      if (editingPromo) {
        const response = await apiRequest("PATCH", `/api/promotions/${editingPromo.id}`, formattedData);
        return response.json();
      }
      const response = await apiRequest("POST", "/api/promotions", formattedData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/promotions"] });
      toast({
        title: editingPromo ? "Promotion updated" : "Promotion created",
        description: "Promotional campaign has been saved successfully.",
      });
      setShowPromoDialog(false);
      setEditingPromo(null);
      promoForm.reset();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save promotion.",
        variant: "destructive",
      });
    },
  });

  // Delete promotion
  const deletePromo = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/promotions/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/promotions"] });
      toast({
        title: "Promotion deleted",
        description: "Promotional campaign has been removed.",
      });
    },
  });

  const promoForm = useForm<PromoFormValues>({
    resolver: zodResolver(promoFormSchema),
    defaultValues: {
      name: "",
      code: "",
      type: "percentage",
      value: 0,
      minPurchase: 0,
      maxDiscount: undefined,
      startDate: new Date().toISOString().split("T")[0],
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      usageLimit: undefined,
      isActive: true,
    },
  });

  const openPromoDialog = (promo?: any) => {
    if (promo) {
      promoForm.reset({
        name: promo.name,
        code: promo.code,
        type: promo.type,
        value: parseFloat(promo.value),
        minPurchase: promo.minPurchase ? parseFloat(promo.minPurchase) : undefined,
        maxDiscount: promo.maxDiscount ? parseFloat(promo.maxDiscount) : undefined,
        startDate: new Date(promo.startDate).toISOString().split("T")[0],
        endDate: new Date(promo.endDate).toISOString().split("T")[0],
        usageLimit: promo.usageLimit || undefined,
        isActive: promo.isActive === 1,
      });
      setEditingPromo(promo);
    } else {
      promoForm.reset();
      setEditingPromo(null);
    }
    setShowPromoDialog(true);
  };

  // Filter promotions
  const filteredPromotions = promotions.filter((promo: any) => {
    const now = new Date();
    const endDate = new Date(promo.endDate);
    
    if (activeFilter === "active") {
      return promo.isActive === 1 && endDate >= now;
    } else if (activeFilter === "expired") {
      return endDate < now;
    }
    return true;
  });

  // Calculate stats
  const activeCount = promotions.filter((p: any) => {
    const now = new Date();
    const endDate = new Date(p.endDate);
    return p.isActive === 1 && endDate >= now;
  }).length;

  const totalUsage = promotions.reduce((sum: number, p: any) => sum + (p.usageCount || 0), 0);

  const getPromoTypeIcon = (type: string) => {
    switch (type) {
      case "percentage":
        return <Percent className="h-4 w-4" />;
      case "fixed":
        return <DollarSign className="h-4 w-4" />;
      case "bogo":
        return <Gift className="h-4 w-4" />;
      case "points":
        return <Tag className="h-4 w-4" />;
      default:
        return <Tag className="h-4 w-4" />;
    }
  };

  const getPromoStatus = (promo: any) => {
    const now = new Date();
    const startDate = new Date(promo.startDate);
    const endDate = new Date(promo.endDate);
    
    if (promo.isActive === 0) {
      return { label: "Inactive", color: "secondary" };
    } else if (now < startDate) {
      return { label: "Scheduled", color: "warning" };
    } else if (now > endDate) {
      return { label: "Expired", color: "destructive" };
    } else if (promo.usageLimit && promo.usageCount >= promo.usageLimit) {
      return { label: "Exhausted", color: "destructive" };
    } else {
      return { label: "Active", color: "success" };
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl sm:text-3xl font-bold">Promotional Campaigns</h1>
        <Button onClick={() => openPromoDialog()} className="min-h-[44px] w-full sm:w-auto" data-testid="button-add-promotion">
          <Plus className="mr-2 h-4 w-4" />
          New Campaign
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Campaigns</CardTitle>
            <Gift className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-active-campaigns">{activeCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Promotions</CardTitle>
            <Tag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-promotions">{promotions.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Usage</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-usage">{totalUsage}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2">
        <Button
          variant={activeFilter === "all" ? "default" : "outline"}
          onClick={() => setActiveFilter("all")}
          data-testid="filter-all"
        >
          All ({promotions.length})
        </Button>
        <Button
          variant={activeFilter === "active" ? "default" : "outline"}
          onClick={() => setActiveFilter("active")}
          data-testid="filter-active"
        >
          Active ({activeCount})
        </Button>
        <Button
          variant={activeFilter === "expired" ? "default" : "outline"}
          onClick={() => setActiveFilter("expired")}
          data-testid="filter-expired"
        >
          Expired ({promotions.filter((p: any) => new Date(p.endDate) < new Date()).length})
        </Button>
      </div>

      {/* Promotions List */}
      {isLoading ? (
        <div>Loading promotions...</div>
      ) : (
        <div className="grid gap-4">
          {filteredPromotions.map((promo: any) => {
            const status = getPromoStatus(promo);
            
            return (
              <Card key={promo.id} data-testid={`card-promo-${promo.id}`}>
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-secondary rounded-lg">
                        {getPromoTypeIcon(promo.type)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle>{promo.name}</CardTitle>
                          <Badge variant={status.color as any} data-testid={`badge-status-${promo.id}`}>
                            {status.label}
                          </Badge>
                        </div>
                        <code className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded mt-1 inline-block">
                          {promo.code}
                        </code>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openPromoDialog(promo)}
                        data-testid={`button-edit-${promo.id}`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deletePromo.mutate(promo.id)}
                        data-testid={`button-delete-${promo.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Type & Value</p>
                      <p className="font-semibold" data-testid={`text-value-${promo.id}`}>
                        {promo.type === "percentage" && `${promo.value}% OFF`}
                        {promo.type === "fixed" && `$${promo.value} OFF`}
                        {promo.type === "bogo" && "Buy One Get One"}
                        {promo.type === "points" && `${promo.value}x Points`}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Duration</p>
                      <p className="text-sm font-medium">
                        <Calendar className="inline h-3 w-3 mr-1" />
                        {format(new Date(promo.startDate), "MMM d")} - {format(new Date(promo.endDate), "MMM d, yyyy")}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Usage</p>
                      <p className="font-semibold" data-testid={`text-usage-${promo.id}`}>
                        {promo.usageCount || 0}{promo.usageLimit && ` / ${promo.usageLimit}`}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Min Purchase</p>
                      <p className="font-semibold" data-testid={`text-min-${promo.id}`}>
                        {promo.minPurchase ? `$${promo.minPurchase}` : "No minimum"}
                      </p>
                    </div>
                  </div>
                  {promo.maxDiscount && (
                    <div className="mt-2 text-sm text-muted-foreground">
                      Max discount: ${promo.maxDiscount}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {filteredPromotions.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No promotional campaigns found
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Promotion Dialog */}
      <Dialog open={showPromoDialog} onOpenChange={setShowPromoDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingPromo ? "Edit Campaign" : "Create Campaign"}</DialogTitle>
          </DialogHeader>
          <Form {...promoForm}>
            <form onSubmit={promoForm.handleSubmit((data) => promoMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={promoForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Campaign Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., Summer Sale" data-testid="input-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={promoForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Promo Code</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          placeholder="e.g., SUMMER20"
                          onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                          data-testid="input-code"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={promoForm.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Discount Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="percentage">Percentage Off</SelectItem>
                          <SelectItem value="fixed">Fixed Amount Off</SelectItem>
                          <SelectItem value="bogo">Buy One Get One</SelectItem>
                          <SelectItem value="points">Bonus Points</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={promoForm.control}
                  name="value"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Value</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          type="number" 
                          step="0.01"
                          onChange={(e) => field.onChange(parseFloat(e.target.value))}
                          data-testid="input-value"
                        />
                      </FormControl>
                      <FormDescription>
                        {promoForm.watch("type") === "percentage" && "Percentage discount (0-100)"}
                        {promoForm.watch("type") === "fixed" && "Dollar amount off"}
                        {promoForm.watch("type") === "points" && "Points multiplier"}
                        {promoForm.watch("type") === "bogo" && "Not applicable for BOGO"}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={promoForm.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" data-testid="input-start-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={promoForm.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Date</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" data-testid="input-end-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={promoForm.control}
                  name="minPurchase"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum Purchase (Optional)</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          type="number" 
                          step="0.01"
                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                          data-testid="input-min-purchase"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={promoForm.control}
                  name="maxDiscount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Discount (Optional)</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          type="number" 
                          step="0.01"
                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                          data-testid="input-max-discount"
                        />
                      </FormControl>
                      <FormDescription>For percentage discounts only</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={promoForm.control}
                  name="usageLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Usage Limit (Optional)</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          type="number"
                          onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                          data-testid="input-usage-limit"
                        />
                      </FormControl>
                      <FormDescription>Leave empty for unlimited usage</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={promoForm.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Active</FormLabel>
                        <FormDescription>
                          Enable or disable this promotion
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-active"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowPromoDialog(false)}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={promoMutation.isPending} data-testid="button-save">
                  {promoMutation.isPending ? "Saving..." : "Save Campaign"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}