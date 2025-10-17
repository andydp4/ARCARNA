import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { 
  MapPin, 
  Plus, 
  Store, 
  Users, 
  Package, 
  DollarSign,
  Edit,
  Trash2,
  Home,
  CheckCircle,
  XCircle
} from "lucide-react";
import { Link } from "wouter";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

interface Location {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  email: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  stats?: {
    totalRevenue: number;
    totalOrders: number;
    totalProducts: number;
    activeStaff: number;
  };
}

const locationSchema = z.object({
  name: z.string().min(1, "Location name is required"),
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(2, "State is required").max(2, "State must be 2 characters"),
  zipCode: z.string().regex(/^\d{5}(-\d{4})?$/, "Invalid ZIP code format"),
  phone: z.string().regex(/^\(\d{3}\) \d{3}-\d{4}$/, "Phone must be in format (xxx) xxx-xxxx"),
  email: z.string().email("Invalid email address"),
  isActive: z.boolean().default(true),
});

type LocationFormData = z.infer<typeof locationSchema>;

export default function Locations() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string>("");

  // Get current location from localStorage or session
  const currentLocationId = localStorage.getItem("currentLocationId") || "";

  // Fetch locations
  const { data: locations = [], isLoading, refetch } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  // Form setup
  const form = useForm<LocationFormData>({
    resolver: zodResolver(locationSchema),
    defaultValues: {
      name: "",
      address: "",
      city: "",
      state: "",
      zipCode: "",
      phone: "",
      email: "",
      isActive: true,
    },
  });

  // Create/Update location mutation
  const saveMutation = useMutation({
    mutationFn: async (data: LocationFormData & { id?: string }) => {
      if (data.id) {
        return apiRequest("PATCH", `/api/locations/${data.id}`, data);
      }
      return apiRequest("POST", "/api/locations", data);
    },
    onSuccess: () => {
      toast({
        title: editingLocation ? "Location Updated" : "Location Created",
        description: editingLocation 
          ? "Location has been successfully updated."
          : "New location has been successfully created.",
      });
      setDialogOpen(false);
      setEditingLocation(null);
      form.reset();
      refetch();
    },
    onError: (error: any) => {
      toast({
        title: "Operation Failed",
        description: error.message || "Failed to save location",
        variant: "destructive",
      });
    },
  });

  // Delete location mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/locations/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Location Deleted",
        description: "Location has been successfully deleted.",
      });
      setDeletingId(null);
      refetch();
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete location",
        variant: "destructive",
      });
    },
  });

  // Set default location mutation
  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/locations/${id}/set-default`);
    },
    onSuccess: () => {
      toast({
        title: "Default Location Set",
        description: "Default location has been updated.",
      });
      refetch();
    },
    onError: (error: any) => {
      toast({
        title: "Operation Failed",
        description: error.message || "Failed to set default location",
        variant: "destructive",
      });
    },
  });

  // Switch location
  const handleLocationSwitch = (locationId: string) => {
    localStorage.setItem("currentLocationId", locationId);
    setSelectedLocation(locationId);
    toast({
      title: "Location Switched",
      description: `Switched to ${locations.find(l => l.id === locationId)?.name}`,
    });
    // Reload to apply new location context
    window.location.reload();
  };

  // Open edit dialog
  const handleEdit = (location: Location) => {
    setEditingLocation(location);
    form.reset({
      name: location.name,
      address: location.address,
      city: location.city,
      state: location.state,
      zipCode: location.zipCode,
      phone: location.phone,
      email: location.email,
      isActive: location.isActive,
    });
    setDialogOpen(true);
  };

  // Submit form
  const handleSubmit = (data: LocationFormData) => {
    saveMutation.mutate({
      ...data,
      id: editingLocation?.id,
    });
  };

  // Format phone number as user types
  const formatPhoneNumber = (value: string) => {
    const phone = value.replace(/\D/g, '');
    if (phone.length >= 6) {
      return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6, 10)}`;
    } else if (phone.length >= 3) {
      return `(${phone.slice(0, 3)}) ${phone.slice(3)}`;
    }
    return phone;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary border-b border-slate-700 sticky top-0 z-50 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-10 h-10 bg-accent rounded-lg">
                <MapPin className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white">Location Management</h1>
                <p className="text-xs sm:text-sm text-slate-400">Manage Multiple Store Locations</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {locations.length > 0 && (
                <Select value={currentLocationId} onValueChange={handleLocationSwitch}>
                  <SelectTrigger className="w-full sm:w-48 bg-slate-700 text-white border-slate-600 min-h-[44px]" data-testid="select-location">
                    <SelectValue placeholder="Select Location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button asChild variant="ghost" className="text-white min-h-[44px]" data-testid="link-home">
                <Link href="/">
                  <Home className="h-4 w-4 sm:mr-2" />
                  <span className="sr-only sm:not-sr-only">Dashboard</span>
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Locations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <p className="text-2xl font-bold">{locations.length}</p>
                <Store className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Locations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <p className="text-2xl font-bold">{locations.filter(l => l.isActive).length}</p>
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <p className="text-2xl font-bold">
                  ${locations.reduce((sum, l) => {
                    const revenue = typeof l.stats?.totalRevenue === 'string' 
                      ? parseFloat(l.stats.totalRevenue) 
                      : l.stats?.totalRevenue || 0;
                    return sum + (isNaN(revenue) ? 0 : revenue);
                  }, 0).toFixed(2)}
                </p>
                <DollarSign className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Staff</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <p className="text-2xl font-bold">
                  {locations.reduce((sum, l) => sum + (l.stats?.activeStaff || 0), 0)}
                </p>
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Locations Table */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Store Locations</CardTitle>
                <CardDescription>Manage your store locations and their settings</CardDescription>
              </div>
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button onClick={() => {
                    setEditingLocation(null);
                    form.reset();
                  }} className="min-h-[44px]" data-testid="button-add-location">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Location
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>{editingLocation ? "Edit Location" : "Add New Location"}</DialogTitle>
                    <DialogDescription>
                      {editingLocation 
                        ? "Update the location details below."
                        : "Enter the details for the new store location."}
                    </DialogDescription>
                  </DialogHeader>
                  
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Location Name</FormLabel>
                              <FormControl>
                                <Input placeholder="Main Street Store" {...field} className="min-h-[44px]" data-testid="input-location-name" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        
                        <FormField
                          control={form.control}
                          name="phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Phone</FormLabel>
                              <FormControl>
                                <Input 
                                  placeholder="(555) 123-4567" 
                                  {...field}
                                  onChange={(e) => field.onChange(formatPhoneNumber(e.target.value))}
                                  className="min-h-[44px]"
                                  data-testid="input-location-phone"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name="address"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Street Address</FormLabel>
                            <FormControl>
                              <Input placeholder="123 Main Street" {...field} className="min-h-[44px]" data-testid="input-location-address" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="grid grid-cols-3 gap-4">
                        <FormField
                          control={form.control}
                          name="city"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>City</FormLabel>
                              <FormControl>
                                <Input placeholder="New York" {...field} className="min-h-[44px]" data-testid="input-location-city" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        
                        <FormField
                          control={form.control}
                          name="state"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>State</FormLabel>
                              <FormControl>
                                <Input 
                                  placeholder="NY" 
                                  {...field} 
                                  onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                                  maxLength={2}
                                  className="min-h-[44px]"
                                  data-testid="input-location-state"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        
                        <FormField
                          control={form.control}
                          name="zipCode"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>ZIP Code</FormLabel>
                              <FormControl>
                                <Input placeholder="10001" {...field} className="min-h-[44px]" data-testid="input-location-zip" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input 
                                type="email" 
                                placeholder="store@example.com" 
                                {...field} 
                                className="min-h-[44px]"
                                data-testid="input-location-email"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="isActive"
                        render={({ field }) => (
                          <FormItem className="flex items-center gap-2">
                            <FormControl>
                              <input
                                type="checkbox"
                                checked={field.value}
                                onChange={field.onChange}
                                className="h-4 w-4"
                                data-testid="checkbox-location-active"
                              />
                            </FormControl>
                            <FormLabel className="!mt-0">Active Location</FormLabel>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <DialogFooter className="gap-2">
                        <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="min-h-[44px]">
                          Cancel
                        </Button>
                        <Button type="submit" disabled={saveMutation.isPending} className="min-h-[44px]" data-testid="button-save-location">
                          {saveMutation.isPending ? "Saving..." : editingLocation ? "Update" : "Create"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {/* Mobile Card View */}
            {isLoading ? (
              <div className="block lg:hidden text-center py-8">Loading locations...</div>
            ) : locations.length === 0 ? (
              <div className="block lg:hidden text-center py-8">
                No locations found. Add your first location to get started.
              </div>
            ) : (
              <div className="block lg:hidden space-y-4">
                {locations.map((location) => (
                  <Card key={location.id} data-testid={`location-card-${location.id}`}>
                    <CardContent className="pt-6">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              {location.name}
                              {location.isDefault && (
                                <Badge variant="secondary" className="text-xs">Default</Badge>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">{location.email}</div>
                          </div>
                          {location.isActive ? (
                            <Badge variant="outline" className="text-green-600">
                              <CheckCircle className="mr-1 h-3 w-3" />
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-red-600">
                              <XCircle className="mr-1 h-3 w-3" />
                              Inactive
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm space-y-1">
                          <div>{location.address}</div>
                          <div className="text-muted-foreground">
                            {location.city}, {location.state} {location.zipCode}
                          </div>
                          <div className="text-muted-foreground">{location.phone}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                          <div>
                            <div className="text-xs text-muted-foreground">Revenue</div>
                            <div className="font-medium">${location.stats?.totalRevenue?.toFixed(2) || "0.00"}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Orders</div>
                            <div className="font-medium">{location.stats?.totalOrders || 0}</div>
                          </div>
                        </div>
                        <div className="flex gap-2 pt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(location)}
                            className="flex-1 min-h-[44px]"
                            data-testid={`button-edit-${location.id}`}
                          >
                            <Edit className="mr-2 h-3 w-3" />
                            Edit
                          </Button>
                          {!location.isDefault && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setDefaultMutation.mutate(location.id)}
                              disabled={setDefaultMutation.isPending}
                              className="flex-1 min-h-[44px]"
                              data-testid={`button-set-default-${location.id}`}
                            >
                              Set Default
                            </Button>
                          )}
                          {!location.isDefault && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 min-h-[44px]"
                              onClick={() => setDeletingId(location.id)}
                              data-testid={`button-delete-${location.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Desktop Table View */}
            <div className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Location</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Revenue</TableHead>
                    <TableHead>Orders</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">Loading locations...</TableCell>
                    </TableRow>
                  ) : locations.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        No locations found. Add your first location to get started.
                      </TableCell>
                    </TableRow>
                  ) : (
                    locations.map((location) => (
                      <TableRow key={location.id} data-testid={`location-row-${location.id}`}>
                        <TableCell>
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              {location.name}
                              {location.isDefault && (
                                <Badge variant="secondary" className="text-xs">Default</Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">{location.email}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div>{location.address}</div>
                            <div className="text-muted-foreground">
                              {location.city}, {location.state} {location.zipCode}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{location.phone}</TableCell>
                        <TableCell>${location.stats?.totalRevenue?.toFixed(2) || "0.00"}</TableCell>
                        <TableCell>{location.stats?.totalOrders || 0}</TableCell>
                        <TableCell>
                          {location.isActive ? (
                            <Badge variant="outline" className="text-green-600">
                              <CheckCircle className="mr-1 h-3 w-3" />
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-red-600">
                              <XCircle className="mr-1 h-3 w-3" />
                              Inactive
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(location)}
                              className="min-h-[44px]"
                              data-testid={`button-edit-${location.id}`}
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            {!location.isDefault && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setDefaultMutation.mutate(location.id)}
                                disabled={setDefaultMutation.isPending}
                                className="min-h-[44px]"
                                data-testid={`button-set-default-${location.id}`}
                              >
                                Set Default
                              </Button>
                            )}
                            {!location.isDefault && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-red-600 min-h-[44px]"
                                onClick={() => setDeletingId(location.id)}
                                data-testid={`button-delete-${location.id}`}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Location</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this location? This action cannot be undone.
              All data associated with this location will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeletingId(null)} className="min-h-[44px]">
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => deletingId && deleteMutation.mutate(deletingId)}
              disabled={deleteMutation.isPending}
              className="min-h-[44px]"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}