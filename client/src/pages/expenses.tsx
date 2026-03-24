import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { offlineStorage } from "@/lib/offline-storage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, TrendingDown, DollarSign, Calendar, FileText } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { insertOverheadExpenseSchema, type InsertOverheadExpense, type OverheadExpense } from "@shared/schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ExpenseRow } from "@/components/expense-row";
import { ExpensesPageSkeleton } from "@/components/reporting-skeletons";

type ExpenseFormData = {
  name: string;
  category: string;
  amount: string;
  frequency: string;
  startDate: Date;
  endDate?: Date;
  isActive: number;
  description?: string;
};

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1, "Category is required"),
  amount: z.coerce.number().positive("Amount must be a positive number"),
  frequency: z.string().min(1, "Frequency is required"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional(),
  isActive: z.number(),
  description: z.string().optional(),
});

export function ExpensesPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<OverheadExpense | null>(null);
  const { toast } = useToast();

  const {
    data: expensesData,
    isPending: expensesPending,
    isFetching: expensesFetching,
  } = useQuery<OverheadExpense[]>({
    queryKey: ["/api/overhead-expenses"],
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
  });
  const expenses = expensesData ?? [];
  const expensesInitialLoad = expensesPending && expensesData === undefined;

  const { data: analytics, isFetching: analyticsFetching } = useQuery({
    queryKey: ["/api/expense-analytics"],
    queryFn: async () => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const response = await apiRequest(
        "GET",
        `/api/expense-analytics?startDate=${startOfMonth.toISOString()}&endDate=${endOfMonth.toISOString()}`,
        null
      );
      return response.json();
    },
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertOverheadExpense) => {
      if (!navigator.onLine) {
        await offlineStorage.queueMutation({
          type: 'EXPENSE_CREATE',
          method: 'POST',
          endpoint: '/api/overhead-expenses',
          data
        });
        return { offline: true };
      }
      return apiRequest("POST", "/api/overhead-expenses", data);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expense-analytics"] });
      toast({
        title: "Success",
        description: data?.offline ? "Expense saved offline and will sync when connection returns" : "Overhead expense created successfully",
      });
      setIsDialogOpen(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create expense",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<InsertOverheadExpense> }) =>
      apiRequest("PUT", `/api/overhead-expenses/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expense-analytics"] });
      toast({
        title: "Success",
        description: "Overhead expense updated successfully",
      });
      setIsDialogOpen(false);
      setEditingExpense(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update expense",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/overhead-expenses/${id}`, null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expense-analytics"] });
      toast({
        title: "Success",
        description: "Overhead expense deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete expense",
        variant: "destructive",
      });
    },
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      category: "rent",
      amount: 0,
      frequency: "monthly",
      startDate: new Date().toISOString().split('T')[0],
      endDate: "",
      isActive: 1,
      description: "",
    },
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    // Convert the form data to InsertOverheadExpense format
    const expenseData: any = {
      name: data.name,
      category: data.category,
      amount: data.amount.toString(),
      frequency: data.frequency,
      startDate: new Date(data.startDate),
      isActive: data.isActive,
    };
    
    // Only include optional fields if they have values
    if (data.endDate && data.endDate.trim() !== "") {
      expenseData.endDate = new Date(data.endDate);
    }
    if (data.description) {
      expenseData.description = data.description;
    }
    
    if (editingExpense) {
      updateMutation.mutate({ id: editingExpense.id, data: expenseData });
    } else {
      createMutation.mutate(expenseData);
    }
  };

  const openEditDialog = useCallback(
    (expense: OverheadExpense) => {
      setEditingExpense(expense);
      form.reset({
        name: expense.name,
        category: expense.category,
        amount: parseFloat(expense.amount),
        frequency: expense.frequency,
        startDate: new Date(expense.startDate).toISOString().split("T")[0],
        endDate: expense.endDate ? new Date(expense.endDate).toISOString().split("T")[0] : "",
        isActive: expense.isActive,
        description: expense.description || "",
      });
      setIsDialogOpen(true);
    },
    [form.reset]
  );

  const openCreateDialog = () => {
    setEditingExpense(null);
    form.reset({
      name: "",
      category: "rent",
      amount: 0,
      frequency: "monthly",
      startDate: new Date().toISOString().split('T')[0],
      endDate: "",
      isActive: 1,
      description: "",
    });
    setIsDialogOpen(true);
  };

  const formatCurrency = (amount: string | number) => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(numAmount);
  };

  const handleDeleteExpense = useCallback((id: string) => {
    deleteMutation.mutate(id);
  }, [deleteMutation.mutate]);

  if (expensesInitialLoad) {
    return <ExpensesPageSkeleton />;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Expense Management</h1>
          {(expensesFetching || analyticsFetching) && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Refreshing…
            </p>
          )}
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <a href="/expense-reports" className="flex-1 sm:flex-initial">
            <Button variant="outline" className="min-h-[44px] w-full" data-testid="button-view-reports">
              <FileText className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">View Reports</span>
            </Button>
          </a>
          <Button onClick={openCreateDialog} className="min-h-[44px] flex-1 sm:flex-initial" data-testid="button-add-expense">
            <Plus className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Add Expense</span>
          </Button>
        </div>
      </div>

      {/* Analytics Cards */}
      {analytics && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Daily Overhead</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-daily-overhead">
                {formatCurrency(analytics.dailyOverhead)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Monthly Overhead</CardTitle>
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-monthly-overhead">
                {formatCurrency(analytics.overheadTotal)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Order Expenses</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-order-expenses">
                {formatCurrency(analytics.orderExpenseTotal)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600" data-testid="text-total-expenses">
                {formatCurrency(analytics.totalExpenses)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Expenses Table */}
      <Card>
        <CardHeader>
          <CardTitle>Overhead Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          {expenses.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No overhead expenses yet. Add your first expense to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((expense) => (
                  <ExpenseRow
                    key={expense.id}
                    expense={expense}
                    onEdit={openEditDialog}
                    onDelete={handleDeleteExpense}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[525px]">
          <DialogHeader>
            <DialogTitle>
              {editingExpense ? "Edit Overhead Expense" : "Add Overhead Expense"}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Monthly Office Rent" data-testid="input-expense-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-expense-category">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="rent">Rent</SelectItem>
                        <SelectItem value="utilities">Utilities</SelectItem>
                        <SelectItem value="salaries">Salaries</SelectItem>
                        <SelectItem value="insurance">Insurance</SelectItem>
                        <SelectItem value="marketing">Marketing</SelectItem>
                        <SelectItem value="maintenance">Maintenance</SelectItem>
                        <SelectItem value="supplies">Supplies</SelectItem>
                        <SelectItem value="taxes">Taxes</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        type="number" 
                        step="0.01" 
                        placeholder="0.00" 
                        data-testid="input-expense-amount"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="frequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Frequency</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-expense-frequency">
                          <SelectValue placeholder="Select frequency" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="yearly">Yearly</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        type="date" 
                        data-testid="input-expense-start-date"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date (Optional)</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        type="date" 
                        data-testid="input-expense-end-date"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Optional)</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        value={field.value || ''} 
                        placeholder="Additional notes..." 
                        data-testid="input-expense-description" 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-save-expense">
                  {editingExpense ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}