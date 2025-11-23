import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { offlineStorage } from "@/lib/offline-storage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Clock, PackageCheck, AlertCircle, Truck, CheckCircle2, MoreVertical, Eye, User, CreditCard, Calendar, Trash2, Edit2, Minus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ORDER_STATUSES, type OrderStatus } from "@shared/schema";
import { Separator } from "@/components/ui/separator";

interface Order {
  id: string;
  customerId?: string;
  customerName?: string;
  total: string;
  paymentMethod: string;
  status: string;
  createdAt: string;
}

interface OrderDetail extends Order {
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: string;
    total: string;
  }>;
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
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [orderToEdit, setOrderToEdit] = useState<OrderDetail | null>(null);
  const [editLines, setEditLines] = useState<Array<{productId: string; productName: string; quantity: number; unitPrice: number}>>([]);
  const [newStatus, setNewStatus] = useState("");
  const [orderDetailsId, setOrderDetailsId] = useState<string | null>(null);

  // Fetch orders
  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Fetch order details
  const { data: orderDetails, isLoading: isLoadingDetails } = useQuery<OrderDetail>({
    queryKey: ["order-details", orderDetailsId],
    enabled: !!orderDetailsId,
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

  // Delete order mutation
  const deleteOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      if (!navigator.onLine) {
        await offlineStorage.queueMutation({
          type: 'ORDER_DELETE',
          method: 'DELETE',
          endpoint: `/api/orders/${orderId}`,
          data: {},
        });
        return { offline: true };
      }
      const response = await apiRequest("DELETE", `/api/orders/${orderId}`);
      return response.json();
    },
    onSuccess: (data, orderId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["order-details", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics"] });
      
      if (data.offline) {
        toast({
          title: "Order Queued for Deletion",
          description: "Order will be deleted when you're back online.",
        });
      } else {
        toast({
          title: "Order Deleted",
          description: "Order has been successfully deleted and stock has been released.",
        });
      }
      setDeleteDialogOpen(false);
      setOrderToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete order",
        variant: "destructive",
      });
    },
  });

  // Edit order mutation
  const editOrderMutation = useMutation({
    mutationFn: async (data: { orderId: string; lines: Array<{productId: string; quantity: number; unitPrice: number}> }) => {
      const response = await apiRequest("PUT", `/api/orders/${data.orderId}`, {
        lines: data.lines,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["order-details", orderToEdit?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics"] });
      
      if (data?.warnings && data.warnings.length > 0) {
        toast({
          title: "Order Updated with Warnings",
          description: data.warnings.join(". ") + ". Order status may have changed.",
          variant: "destructive",
          duration: 8000,
        });
      } else {
        toast({
          title: "Order Updated",
          description: "Order has been successfully updated.",
        });
      }
      setEditDialogOpen(false);
      setOrderToEdit(null);
      setEditLines([]);
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update order",
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

  const openDetailsDialog = (orderId: string) => {
    setOrderDetailsId(orderId);
    setDetailsDialogOpen(true);
  };

  const closeDetailsDialog = () => {
    setDetailsDialogOpen(false);
    setOrderDetailsId(null);
  };

  const openDeleteDialog = (order: Order) => {
    setOrderToDelete(order);
    setDeleteDialogOpen(true);
  };

  const handleDelete = () => {
    if (!orderToDelete || deleteOrderMutation.isPending) return;
    deleteOrderMutation.mutate(orderToDelete.id);
  };

  const openEditDialog = async (orderId: string) => {
    setOrderDetailsId(orderId);
    const response = await fetch(`/api/orders/${orderId}`, { credentials: 'include' });
    const orderData = await response.json();
    setOrderToEdit(orderData);
    setEditLines(orderData.items.map((item: any) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: parseFloat(item.unitPrice),
    })));
    setEditDialogOpen(true);
  };

  const handleEditLineChange = (index: number, field: 'quantity' | 'unitPrice', value: number) => {
    setEditLines(prev => prev.map((line, i) => 
      i === index ? { ...line, [field]: value } : line
    ));
  };

  const handleRemoveLine = (index: number) => {
    setEditLines(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveEdit = () => {
    if (!orderToEdit || editLines.length === 0) return;
    editOrderMutation.mutate({
      orderId: orderToEdit.id,
      lines: editLines.map(line => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
    });
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
                              <DropdownMenuItem onClick={() => openDetailsDialog(order.id)} data-testid="menu-view-details">
                                <Eye className="mr-2 h-4 w-4" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEditDialog(order.id)} data-testid="menu-edit-order">
                                <Edit2 className="mr-2 h-4 w-4" />
                                Edit Order
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openStatusDialog(order)} data-testid="menu-update-status">
                                Update Status
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => openDeleteDialog(order)} 
                                data-testid="menu-delete-order"
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete Order
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

        {/* Order Details Dialog */}
        <Dialog open={detailsDialogOpen} onOpenChange={closeDetailsDialog}>
          <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Order Details</DialogTitle>
              <DialogDescription>
                Complete information for order #{orderDetails?.id.slice(0, 8) || '...'}
              </DialogDescription>
            </DialogHeader>
            {isLoadingDetails ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : orderDetails && (
              <div className="space-y-4">
                {/* Order Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <User className="h-4 w-4" />
                      <span>Customer</span>
                    </div>
                    <p className="font-medium">{orderDetails.customerName}</p>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CreditCard className="h-4 w-4" />
                      <span>Payment</span>
                    </div>
                    <p className="font-medium capitalize">{orderDetails.paymentMethod}</p>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span>Date</span>
                    </div>
                    <p className="font-medium">{new Date(orderDetails.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <PackageCheck className="h-4 w-4" />
                      <span>Status</span>
                    </div>
                    <div>{getStatusBadge(orderDetails.status)}</div>
                  </div>
                </div>

                <Separator />

                {/* Order Items */}
                <div>
                  <h4 className="font-semibold mb-3">Order Items</h4>
                  <div className="space-y-2">
                    {orderDetails.items?.map((item) => (
                      <div key={item.id} className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                        <div className="flex-1">
                          <p className="font-medium">{item.productName || 'Unknown Product'}</p>
                          <p className="text-sm text-muted-foreground">
                            {item.quantity} × ${typeof item.unitPrice === 'string' ? parseFloat(item.unitPrice).toFixed(2) : item.unitPrice.toFixed(2)}
                          </p>
                        </div>
                        <div className="font-semibold">
                          ${typeof item.total === 'string' ? parseFloat(item.total).toFixed(2) : item.total.toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Order Total */}
                <div className="flex justify-between items-center text-lg font-bold">
                  <span>Total</span>
                  <span className="text-2xl text-primary">
                    ${parseFloat(orderDetails.total).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button onClick={closeDetailsDialog} className="min-h-[44px]">Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Delete Order</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete order #{orderToDelete?.id.slice(0, 8)}?
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <p className="text-sm text-muted-foreground">
                This action cannot be undone. The order will be permanently deleted and any reserved stock will be released back to inventory.
              </p>
              <div className="mt-4 p-3 bg-muted rounded-lg">
                <p className="text-sm font-medium">Order Details:</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Total: ${orderToDelete?.total ? parseFloat(orderToDelete.total).toFixed(2) : '0.00'}
                </p>
                <p className="text-sm text-muted-foreground">
                  Payment: {orderToDelete?.paymentMethod}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteDialogOpen(false)}
                className="min-h-[44px]"
                data-testid="button-cancel-delete"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteOrderMutation.isPending}
                className="min-h-[44px]"
                data-testid="button-confirm-delete"
              >
                {deleteOrderMutation.isPending ? "Deleting..." : "Delete Order"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Order Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Order</DialogTitle>
              <DialogDescription>
                Modify line items, quantities, and prices for order #{orderToEdit?.id.slice(0, 8)}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {editLines.map((line, index) => (
                <div key={index} className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                  <div className="flex-1 space-y-2">
                    <p className="text-sm font-medium">{line.productName}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground">Quantity</label>
                        <Input
                          type="number"
                          min="1"
                          value={line.quantity}
                          onChange={(e) => handleEditLineChange(index, 'quantity', parseInt(e.target.value) || 1)}
                          className="min-h-[44px]"
                          data-testid={`input-edit-quantity-${index}`}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Price</label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(e) => handleEditLineChange(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                          className="min-h-[44px]"
                          data-testid={`input-edit-price-${index}`}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Subtotal: ${(line.quantity * line.unitPrice).toFixed(2)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveLine(index)}
                    className="min-h-[44px] min-w-[44px]"
                    data-testid={`button-remove-line-${index}`}
                  >
                    <Minus className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
              
              {editLines.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No line items. Add at least one item to save.
                </p>
              )}

              <Separator />

              <div className="flex justify-between items-center">
                <span className="font-semibold">New Total:</span>
                <span className="text-xl font-bold text-primary">
                  ${editLines.reduce((sum, line) => sum + (line.quantity * line.unitPrice), 0).toFixed(2)}
                </span>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setEditDialogOpen(false)}
                className="min-h-[44px]"
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveEdit}
                disabled={editOrderMutation.isPending || editLines.length === 0}
                className="min-h-[44px]"
                data-testid="button-save-edit"
              >
                {editOrderMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
