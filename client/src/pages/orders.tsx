import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { offlineStorage } from "@/lib/offline-storage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Clock, PackageCheck, AlertCircle, Truck, CheckCircle2, MoreVertical, Eye } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ORDER_STATUSES, type OrderStatus } from "@shared/schema";

interface Order {
  id: string;
  customerId?: string;
  total: string;
  paymentMethod: string;
  status: string;
  createdAt: string;
}

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; icon: any }> = {
  pending: { label: "Pending", color: "bg-yellow-500", icon: Clock },
  "on-hold": { label: "On Hold", color: "bg-orange-500", icon: AlertCircle },
  "awaiting-customer": { label: "Awaiting Customer", color: "bg-blue-500", icon: Truck },
  urgent: { label: "Urgent", color: "bg-red-500", icon: AlertCircle },
  completed: { label: "Completed", color: "bg-green-500", icon: CheckCircle2 },
};

export default function Orders() {
  const { toast } = useToast();
  const [filterStatus, setFilterStatus] = useState<string>("active");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [newStatus, setNewStatus] = useState("");

  // Fetch orders
  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Update order status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async (data: { orderId: string; status: string }) => {
      if (!navigator.onLine) {
        await offlineStorage.queueMutation({
          type: 'ORDER_UPDATE',
          method: 'PATCH',
          endpoint: `/api/orders/${data.orderId}`,
          data: { status: data.status }
        });
        return { offline: true };
      }
      
      const response = await apiRequest("PATCH", `/api/orders/${data.orderId}`, {
        status: data.status,
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      if (data?.offline) {
        toast({
          title: "Update Queued",
          description: "Status update saved offline and will sync when connection returns.",
        });
      } else {
        toast({
          title: "Status Updated",
          description: "Order status has been successfully updated.",
        });
      }
      setStatusDialogOpen(false);
      setSelectedOrder(null);
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update order status",
        variant: "destructive",
      });
    },
  });

  // Filter orders based on status
  const filteredOrders = orders.filter((order) => {
    if (filterStatus === "active") {
      return order.status !== "completed";
    } else if (filterStatus === "completed") {
      return order.status === "completed";
    } else if (filterStatus === "all") {
      return true;
    }
    return order.status === filterStatus;
  });

  // Group orders by status
  const groupedOrders = filteredOrders.reduce((acc, order) => {
    const status = order.status || "pending";
    if (!acc[status]) {
      acc[status] = [];
    }
    acc[status].push(order);
    return acc;
  }, {} as Record<string, Order[]>);

  const getStatusBadge = (status: string) => {
    const config = STATUS_CONFIG[status as OrderStatus] || {
      label: status,
      color: "bg-gray-500",
      icon: Clock,
    };
    return (
      <Badge className={`${config.color} text-white`} data-testid={`badge-status-${status}`}>
        {config.label}
      </Badge>
    );
  };

  const openStatusDialog = (order: Order) => {
    setSelectedOrder(order);
    setNewStatus(order.status || "pending");
    setStatusDialogOpen(true);
  };

  const handleStatusUpdate = () => {
    if (!selectedOrder || !newStatus) return;
    updateStatusMutation.mutate({
      orderId: selectedOrder.id,
      status: newStatus,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Stats
  const stats = {
    total: orders.length,
    active: orders.filter((o) => o.status !== "completed").length,
    urgent: orders.filter((o) => o.status === "urgent").length,
    completed: orders.filter((o) => o.status === "completed").length,
  };

  return (
    <div className="w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Orders Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track and manage all orders from creation to completion
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-4">
              <CardTitle className="text-xs sm:text-sm font-medium">Total Orders</CardTitle>
              <PackageCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold" data-testid="stat-total-orders">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-4">
              <CardTitle className="text-xs sm:text-sm font-medium">Active</CardTitle>
              <Clock className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold" data-testid="stat-active-orders">{stats.active}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-4">
              <CardTitle className="text-xs sm:text-sm font-medium">Urgent</CardTitle>
              <AlertCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold" data-testid="stat-urgent-orders">{stats.urgent}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-4">
              <CardTitle className="text-xs sm:text-sm font-medium">Completed</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold" data-testid="stat-completed-orders">{stats.completed}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filter Tabs */}
        <div className="mb-6">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-filter-status">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Orders</SelectItem>
              <SelectItem value="active">Active Orders</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
              <SelectItem value="on-hold">On Hold</SelectItem>
              <SelectItem value="awaiting-customer">Awaiting Customer</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Orders List */}
        {filteredOrders.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <PackageCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No orders found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedOrders).map(([status, statusOrders]) => (
              <Card key={status}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {getStatusBadge(status)}
                      <span className="text-sm text-muted-foreground">
                        ({statusOrders.length} {statusOrders.length === 1 ? "order" : "orders"})
                      </span>
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {statusOrders.map((order) => (
                      <div
                        key={order.id}
                        className="flex items-center justify-between p-4 bg-muted/50 rounded-lg"
                        data-testid={`order-${order.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <p className="font-medium text-sm truncate">
                              Order #{order.id.slice(0, 8)}
                            </p>
                            <Badge variant="outline" className="text-xs">
                              {order.paymentMethod}
                            </Badge>
                          </div>
                          <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-bold text-foreground">
                              ${parseFloat(order.total).toFixed(2)}
                            </span>
                            <span className="hidden sm:inline">•</span>
                            <span>{new Date(order.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="min-h-[44px] min-w-[44px]"
                                data-testid={`button-order-actions-${order.id}`}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openStatusDialog(order)} data-testid="menu-update-status">
                                Update Status
                              </DropdownMenuItem>
                              <DropdownMenuItem data-testid="menu-view-details">
                                <Eye className="mr-2 h-4 w-4" />
                                View Details
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Status Update Dialog */}
        <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Update Order Status</DialogTitle>
              <DialogDescription>
                Change the status of order #{selectedOrder?.id.slice(0, 8)}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger data-testid="select-new-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_CONFIG[status].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStatusDialogOpen(false)}
                className="min-h-[44px]"
              >
                Cancel
              </Button>
              <Button
                onClick={handleStatusUpdate}
                disabled={updateStatusMutation.isPending}
                className="min-h-[44px]"
                data-testid="button-confirm-status-update"
              >
                {updateStatusMutation.isPending ? "Updating..." : "Update Status"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
