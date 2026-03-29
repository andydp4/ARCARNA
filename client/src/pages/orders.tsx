import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { offlineStorage } from "@/lib/offline-storage";
import {
  invalidateAfterOrderMutation,
  invalidateAfterOrderStatusChange,
} from "@/lib/query-invalidation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Clock,
  PackageCheck,
  AlertCircle,
  CheckCircle2,
  Minus,
  Copy,
  Check,
  Building,
  MapPin,
  Search,
} from "lucide-react";
import { ORDER_STATUSES, type OrderStatus } from "@shared/schema";
import { Separator } from "@/components/ui/separator";
import {
  OrdersRow,
  StatusBadge,
  STATUS_CONFIG,
  formatPaymentLabel,
  type OrdersListOrder,
} from "@/components/orders-row";
import { OrdersPageSkeleton } from "@/components/orders-skeleton";
import { AppPageHeader } from "@/components/app-page-header";
import { ActionLoader } from "@/components/action-loader";
import { EmptyStatePanel } from "@/components/empty-state-panel";

type Order = OrdersListOrder;

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

const STATUS_GROUP_ORDER = ["urgent", "on-hold", "awaiting-customer", "pending", "completed"] as const;

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
  const [copiedText, setCopiedText] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(""), 2000);
    toast({
      title: "Copied",
      description: `${label} copied to clipboard`,
    });
  };

  const {
    data: ordersData,
    isPending: ordersPending,
    isFetching: ordersFetching,
  } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
    refetchInterval: 10000,
    placeholderData: (previousData) => previousData,
  });
  const orders = ordersData ?? [];
  const ordersInitialLoad = ordersPending && ordersData === undefined;

  // Fetch order details
  const { data: orderDetails, isLoading: isLoadingDetails } = useQuery<OrderDetail>({
    queryKey: ["/api/orders", orderDetailsId],
    queryFn: async () => {
      const response = await fetch(`/api/orders/${orderDetailsId}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch order details');
      return response.json();
    },
    enabled: !!orderDetailsId,
  });

  // Fetch settings for bank details and collection address
  const { data: settings } = useQuery<any>({
    queryKey: ["/api/settings"],
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
    onMutate: async ({ orderId, status }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/orders"] });
      await queryClient.cancelQueries({ queryKey: ["/api/orders", orderId] });

      const previousOrders = queryClient.getQueryData<Order[]>(["/api/orders"]);
      const previousOrderDetail = queryClient.getQueryData<OrderDetail>(["/api/orders", orderId]);

      queryClient.setQueryData<Order[]>(["/api/orders"], (current = []) =>
        current.map((order) =>
          order.id === orderId
            ? {
                ...order,
                status,
              }
            : order
        )
      );

      if (previousOrderDetail) {
        queryClient.setQueryData<OrderDetail>(["/api/orders", orderId], {
          ...previousOrderDetail,
          status,
        });
      }

      if (selectedOrder?.id === orderId) {
        setSelectedOrder({
          ...selectedOrder,
          status,
        });
      }

      return { previousOrders, previousOrderDetail, orderId };
    },
    onSuccess: async (data: any) => {
      await invalidateAfterOrderStatusChange(queryClient);
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
    onError: (error: any, _vars, context) => {
      if (context?.previousOrders) {
        queryClient.setQueryData(["/api/orders"], context.previousOrders);
        if (selectedOrder?.id) {
          const restored = context.previousOrders.find((order) => order.id === selectedOrder.id);
          if (restored) setSelectedOrder(restored);
        }
      }
      if (context?.previousOrderDetail && context?.orderId) {
        queryClient.setQueryData(["/api/orders", context.orderId], context.previousOrderDetail);
      }
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
    onSuccess: async (data) => {
      await invalidateAfterOrderMutation(queryClient);
      
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
    onSuccess: async (data) => {
      await invalidateAfterOrderMutation(queryClient);
      
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

  const sortedGroupEntries = useMemo(() => {
    const statusFiltered = orders.filter((order) => {
      if (filterStatus === "active") return order.status !== "completed";
      if (filterStatus === "completed") return order.status === "completed";
      if (filterStatus === "all") return true;
      return order.status === filterStatus;
    });

    const q = searchQuery.trim().toLowerCase();
    const filtered = statusFiltered.filter((order) => {
      if (!q) return true;
      const customer = (order.customerName || "").toLowerCase();
      return (
        customer.includes(q) ||
        order.id.toLowerCase().includes(q) ||
        (order.paymentMethod || "").toLowerCase().includes(q)
      );
    });

    const grouped = filtered.reduce(
      (acc, order) => {
        const status = order.status || "pending";
        if (!acc[status]) acc[status] = [];
        acc[status].push(order);
        return acc;
      },
      {} as Record<string, Order[]>
    );

    return Object.entries(grouped).sort(([a], [b]) => {
      const ia = STATUS_GROUP_ORDER.indexOf(a as OrderStatus);
      const ib = STATUS_GROUP_ORDER.indexOf(b as OrderStatus);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [orders, filterStatus, searchQuery]);

  const openStatusDialog = useCallback((order: Order) => {
    setSelectedOrder(order);
    setNewStatus(order.status || "pending");
    setStatusDialogOpen(true);
  }, []);

  const openDetailsDialog = useCallback((orderId: string) => {
    setOrderDetailsId(orderId);
    setDetailsDialogOpen(true);
  }, []);

  const closeDetailsDialog = useCallback(() => {
    setDetailsDialogOpen(false);
    setOrderDetailsId(null);
  }, []);

  const openDeleteDialog = useCallback((order: Order) => {
    setOrderToDelete(order);
    setDeleteAcknowledged(false);
    setDeleteDialogOpen(true);
  }, []);

  const openEditDialog = useCallback(async (orderId: string) => {
    setOrderDetailsId(orderId);
    const response = await fetch(`/api/orders/${orderId}`, { credentials: "include" });
    const orderData = await response.json();
    setOrderToEdit(orderData);
    setEditLines(
      orderData.items.map((item: any) => ({
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: parseFloat(item.unitPrice),
      }))
    );
    setEditDialogOpen(true);
  }, []);

  const handleDelete = () => {
    if (!orderToDelete || deleteOrderMutation.isPending) return;
    deleteOrderMutation.mutate(orderToDelete.id);
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

  const stats = useMemo(
    () => ({
      total: orders.length,
      active: orders.filter((o) => o.status !== "completed").length,
      urgent: orders.filter((o) => o.status === "urgent").length,
      completed: orders.filter((o) => o.status === "completed").length,
    }),
    [orders]
  );

  if (ordersInitialLoad) {
    return <OrdersPageSkeleton />;
  }

  return (
    <div className="w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
        <AppPageHeader
          title="Orders"
          description="Track and manage orders from creation through completion. Filter by status or search by customer, ID, or payment."
          trailing={
            ordersFetching ? (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                Refreshing orders…
              </p>
            ) : undefined
          }
        />

        {/* Stats Cards */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:gap-4 lg:grid-cols-4">
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground sm:text-sm">Total orders</CardTitle>
              <PackageCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold tabular-nums tracking-tight" data-testid="stat-total-orders">
                {stats.total}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">All statuses</p>
            </CardContent>
          </Card>
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground sm:text-sm">Active</CardTitle>
              <Clock className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold tabular-nums tracking-tight" data-testid="stat-active-orders">
                {stats.active}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Excludes completed</p>
            </CardContent>
          </Card>
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground sm:text-sm">Urgent</CardTitle>
              <AlertCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold tabular-nums tracking-tight" data-testid="stat-urgent-orders">
                {stats.urgent}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Highest-priority queue</p>
            </CardContent>
          </Card>
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground sm:text-sm">Completed</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold tabular-nums tracking-tight" data-testid="stat-completed-orders">
                {stats.completed}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Ready to archive</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters & search */}
        <Card className="mb-8 border-border/60 bg-muted/[0.04] shadow-sm">
          <CardContent className="p-4 sm:p-5 sm:pt-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="flex-1 min-w-[min(100%,14rem)] space-y-2">
                <Label htmlFor="order-status-filter" className="text-muted-foreground">
                  Status
                </Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger id="order-status-filter" className="min-h-[44px] w-full" data-testid="select-filter-status">
                    <SelectValue placeholder="Choose which orders to show" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All orders</SelectItem>
                    <SelectItem value="active">Active (not completed)</SelectItem>
                    <SelectItem value="completed">Completed only</SelectItem>
                    <SelectItem value="urgent">Urgent only</SelectItem>
                    <SelectItem value="on-hold">On hold</SelectItem>
                    <SelectItem value="awaiting-customer">Awaiting customer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[min(100%,14rem)] space-y-2">
                <Label htmlFor="order-search" className="text-muted-foreground">
                  Search
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="order-search"
                    placeholder="Customer, order ID, or payment…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="min-h-[44px] pl-9"
                    data-testid="input-order-search"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Orders List */}
        {sortedGroupEntries.length === 0 ? (
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 sm:p-8">
              {orders.length === 0 ? (
                <EmptyStatePanel
                  variant="empty"
                  icon={PackageCheck}
                  title="No orders yet"
                  description="New orders from POS and other channels will show up here when they are created."
                />
              ) : searchQuery.trim() ? (
                <EmptyStatePanel
                  variant="search"
                  icon={Search}
                  title="No orders match your search"
                  description="Try another customer name, order ID fragment, or payment keyword—or clear the search field."
                />
              ) : (
                <EmptyStatePanel
                  variant="filtered"
                  icon={PackageCheck}
                  title="Nothing in this view"
                  description="Change the status filter or choose “All orders” to see more rows."
                />
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-5">
            {sortedGroupEntries.map(([status, statusOrders]) => (
              <Card key={status} className="border-border/60 shadow-sm">
                <CardHeader className="space-y-0 border-b border-border/60 bg-muted/[0.04] pb-4 pt-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1">
                    <StatusBadge status={status} />
                    <span
                      className="text-xs font-medium uppercase tracking-wider text-muted-foreground sm:border-l sm:border-border/60 sm:pl-3"
                      aria-label={`${statusOrders.length} orders in this group`}
                    >
                      <span className="tabular-nums">{statusOrders.length}</span>{" "}
                      {statusOrders.length === 1 ? "order" : "orders"}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="pb-6 pt-0">
                  <ul className="space-y-3 sm:space-y-2.5" role="list">
                    {statusOrders.map((order) => (
                      <OrdersRow
                        key={order.id}
                        order={order}
                        onView={openDetailsDialog}
                        onEdit={openEditDialog}
                        onUpdateStatus={openStatusDialog}
                        onDelete={openDeleteDialog}
                      />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Order Details Dialog */}
        <Dialog
          open={detailsDialogOpen}
          onOpenChange={(open) => {
            if (!open) closeDetailsDialog();
          }}
        >
          <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Order #{orderDetails?.id.slice(0, 8) || "…"}</DialogTitle>
              <DialogDescription className="sr-only">Order details and line items</DialogDescription>
            </DialogHeader>
            {isLoadingDetails ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
                <ActionLoader className="size-8 text-primary" />
                <p className="text-sm">Loading order details…</p>
              </div>
            ) : orderDetails && (
              <div className="space-y-5">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Customer</p>
                        <p className="text-lg font-semibold">{orderDetails.customerName?.trim() || "Walk-in"}</p>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Placed</p>
                          <p className="font-medium">{new Date(orderDetails.createdAt).toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Payment</p>
                          <p className="font-medium capitalize">{formatPaymentLabel(orderDetails.paymentMethod)}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-start gap-2 sm:items-end">
                      <div>
                        <p className="text-xs text-muted-foreground sm:text-right">Status</p>
                        <div className="mt-1">
                          <StatusBadge status={orderDetails.status} />
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Total</p>
                        <p className="text-2xl font-bold tabular-nums text-primary">
                          ${parseFloat(orderDetails.total || "0").toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-medium text-muted-foreground">Line items</h4>
                  <div className="divide-y rounded-lg border">
                    {orderDetails.items?.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{item.productName || "Unknown product"}</p>
                          <p className="text-sm text-muted-foreground tabular-nums">
                            {item.quantity} × ${Number(item?.unitPrice ?? 0).toFixed(2)}
                          </p>
                        </div>
                        <p className="font-semibold tabular-nums sm:text-right">${Number(item?.total ?? 0).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bank Details Section */}
                {(settings?.bankName || settings?.accountNumber || settings?.sortCode) && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="font-semibold mb-3 flex items-center gap-2">
                        <Building className="h-4 w-4" />
                        Bank Details
                      </h4>
                      <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
                        {settings.bankName && (
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Bank:</span>
                            <span className="font-medium">{settings.bankName}</span>
                          </div>
                        )}
                        {settings.accountName && (
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Account Name:</span>
                            <span className="font-medium">{settings.accountName}</span>
                          </div>
                        )}
                        {settings.accountNumber && (
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Account Number:</span>
                            <div className="flex items-center gap-2">
                              <span className="font-medium font-mono">{settings.accountNumber}</span>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-6 w-6"
                                onClick={() => copyToClipboard(settings.accountNumber, 'Account Number')}
                                data-testid="button-copy-account-number"
                              >
                                {copiedText === 'Account Number' ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                              </Button>
                            </div>
                          </div>
                        )}
                        {settings.sortCode && (
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Sort Code:</span>
                            <div className="flex items-center gap-2">
                              <span className="font-medium font-mono">{settings.sortCode}</span>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-6 w-6"
                                onClick={() => copyToClipboard(settings.sortCode, 'Sort Code')}
                                data-testid="button-copy-sort-code"
                              >
                                {copiedText === 'Sort Code' ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* Collection Address Section */}
                {settings?.collectionEnabled && settings?.collectionAddress && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="font-semibold mb-3 flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        Collection Address
                      </h4>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="flex justify-between items-start gap-2">
                          <p className="text-sm whitespace-pre-wrap">{settings.collectionAddress}</p>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 flex-shrink-0"
                            onClick={() => copyToClipboard(settings.collectionAddress, 'Collection Address')}
                            data-testid="button-copy-collection-address"
                          >
                            {copiedText === 'Collection Address' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                          </Button>
                        </div>
                        {settings.collectionInstructions && (
                          <p className="text-xs text-muted-foreground mt-2">{settings.collectionInstructions}</p>
                        )}
                      </div>
                    </div>
                  </>
                )}
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
            <div className="space-y-2 py-4">
              <Label htmlFor="new-order-status">New status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger id="new-order-status" className="min-h-[44px]" data-testid="select-new-status">
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
                className="min-h-[44px] gap-2"
                data-testid="button-confirm-status-update"
              >
                {updateStatusMutation.isPending ? (
                  <>
                    <ActionLoader className="text-primary-foreground" />
                    Updating…
                  </>
                ) : (
                  "Update status"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            setDeleteDialogOpen(open);
            if (!open) {
              setDeleteAcknowledged(false);
              setOrderToDelete(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-[440px] border-destructive/20">
            <DialogHeader>
              <DialogTitle className="text-destructive">Delete this order?</DialogTitle>
              <DialogDescription>
                Order #{orderToDelete?.id.slice(0, 8)} — this cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Stock reserved for this order will be released. Customer and payment records elsewhere are not affected.
              </p>
              <div className="rounded-lg border bg-muted/50 p-3 text-sm">
                <p className="font-medium">{orderToDelete?.customerName?.trim() || "Walk-in"}</p>
                <p className="mt-1 text-muted-foreground tabular-nums">
                  Total ${orderToDelete?.total ? parseFloat(orderToDelete.total).toFixed(2) : "0.00"} ·{" "}
                  {formatPaymentLabel(orderToDelete?.paymentMethod || "")}
                </p>
              </div>
              <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <Checkbox
                  id="delete-ack"
                  checked={deleteAcknowledged}
                  onCheckedChange={(c) => setDeleteAcknowledged(c === true)}
                  data-testid="checkbox-delete-ack"
                  className="mt-0.5"
                />
                <Label htmlFor="delete-ack" className="cursor-pointer text-sm font-normal leading-snug">
                  I understand this order will be permanently deleted.
                </Label>
              </div>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between sm:gap-0">
              <Button
                variant="outline"
                onClick={() => setDeleteDialogOpen(false)}
                className="min-h-[44px] w-full sm:w-auto"
                data-testid="button-cancel-delete"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteOrderMutation.isPending || !deleteAcknowledged}
                className="min-h-[44px] w-full gap-2 sm:w-auto"
                data-testid="button-confirm-delete"
              >
                {deleteOrderMutation.isPending ? (
                  <>
                    <ActionLoader className="text-destructive-foreground" />
                    Deleting…
                  </>
                ) : (
                  "Delete permanently"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Order Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit order #{orderToEdit?.id.slice(0, 8)}</DialogTitle>
              <DialogDescription>Change quantities and prices. Remove a line only if you intend to drop that item.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {editLines.map((line, index) => (
                <div key={index} className="rounded-lg border p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="font-medium">{line.productName}</p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor={`edit-qty-${index}`} className="text-xs text-muted-foreground">
                            Quantity
                          </Label>
                          <Input
                            id={`edit-qty-${index}`}
                            type="number"
                            min="1"
                            value={line.quantity}
                            onChange={(e) => handleEditLineChange(index, "quantity", parseInt(e.target.value) || 1)}
                            className="min-h-[44px]"
                            data-testid={`input-edit-quantity-${index}`}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`edit-price-${index}`} className="text-xs text-muted-foreground">
                            Unit price
                          </Label>
                          <Input
                            id={`edit-price-${index}`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.unitPrice}
                            onChange={(e) => handleEditLineChange(index, "unitPrice", parseFloat(e.target.value) || 0)}
                            className="min-h-[44px]"
                            data-testid={`input-edit-price-${index}`}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        Line total: ${(line.quantity * line.unitPrice).toFixed(2)}
                      </p>
                    </div>
                    <div className="flex justify-end border-t pt-3 sm:border-t-0 sm:border-l sm:pl-3 sm:pt-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRemoveLine(index)}
                        className="min-h-[44px] border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        data-testid={`button-remove-line-${index}`}
                        aria-label={`Remove ${line.productName} from order`}
                      >
                        <Minus className="mr-2 h-4 w-4" />
                        Remove line
                      </Button>
                    </div>
                  </div>
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
                className="min-h-[44px] gap-2"
                data-testid="button-save-edit"
              >
                {editOrderMutation.isPending ? (
                  <>
                    <ActionLoader className="text-primary-foreground" />
                    Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
