import { useMemo, useState, useCallback } from "react";
import { apiFetch } from "@/lib/appPaths";
import {
  endOfDay,
  isWithinInterval,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateAfterInvoiceRegeneration } from "@/lib/query-invalidation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { FileText, Search, DollarSign, Clock, AlertCircle } from "lucide-react";
import { InvoiceRow, type InvoiceListItem } from "@/components/invoice-row";
import { InvoicesPageSkeleton } from "@/components/reporting-skeletons";
import { AppPageHeader } from "@/components/app-page-header";
import { ActionLoader } from "@/components/action-loader";
import { DataTableShell } from "@/components/data-table-shell";
import { EmptyState } from "@/components/EmptyState";

interface Invoice extends InvoiceListItem {
  orderId: string;
  customerId: string;
  subtotal: number;
  vat: number;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
}

export default function Invoices() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "paid" | "pending" | "overdue">("all");
  const [selectedPeriod, setSelectedPeriod] = useState<"all" | "today" | "week" | "month">("month");
  const [regenerating, setRegenerating] = useState(false);

  const {
    data: invoicesData,
    isPending: invoicesPending,
    isFetching: invoicesFetching,
  } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
  });
  const invoices = invoicesData ?? [];
  const invoicesInitialLoad = invoicesPending && invoicesData === undefined;

  const periodInvoices = useMemo(() => {
    if (selectedPeriod === "all") return invoices;
    const now = new Date();
    const interval =
      selectedPeriod === "today"
        ? { start: startOfDay(now), end: endOfDay(now) }
        : selectedPeriod === "week"
          ? { start: startOfWeek(now, { weekStartsOn: 0 }), end: endOfDay(now) }
          : { start: startOfMonth(now), end: endOfDay(now) };
    return invoices.filter((inv) => isWithinInterval(new Date(inv.date), interval));
  }, [invoices, selectedPeriod]);

  const filteredInvoices = useMemo(
    () =>
      periodInvoices.filter((invoice) => {
        const matchesSearch =
          invoice.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
          invoice.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          invoice.customerEmail.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesStatus = filterStatus === "all" || invoice.status === filterStatus;

        return matchesSearch && matchesStatus;
      }),
    [periodInvoices, searchTerm, filterStatus]
  );

  const { totalRevenue, pendingRevenue, overdueRevenue } = useMemo(() => {
    let paid = 0;
    let pending = 0;
    let overdue = 0;
    for (const inv of filteredInvoices) {
      if (inv.status === "paid") paid += inv.total;
      else if (inv.status === "pending") pending += inv.total;
      else if (inv.status === "overdue") overdue += inv.total;
    }
    return { totalRevenue: paid, pendingRevenue: pending, overdueRevenue: overdue };
  }, [filteredInvoices]);

  const copyInvoiceNumber = useCallback(
    (invoiceNumber: string) => {
      navigator.clipboard.writeText(invoiceNumber);
      toast({
        title: "Copied",
        description: "Invoice number copied to clipboard",
      });
    },
    [toast]
  );

  const viewInvoicePdf = useCallback(
    async (invoiceId: string, invoiceNumber: string) => {
      try {
        const response = await apiFetch(`/api/invoices/${invoiceId}/pdf`, {
          credentials: "include",
        });

        if (response.ok) {
          const data = await response.json();
          if (data.pdfUrl) {
            window.open(data.pdfUrl, "_blank");
          } else {
            toast({
              title: "PDF Not Available",
              description:
                "This invoice PDF has not been generated yet. Click \"Generate Missing PDFs\" to create it.",
              variant: "destructive",
            });
          }
        } else {
          toast({
            title: "Error",
            description: "Could not retrieve invoice PDF",
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: "Error",
          description: "Failed to get invoice PDF",
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  const printInvoice = useCallback(
    async (invoiceId: string, invoiceNumber: string) => {
      try {
        const response = await apiFetch(`/api/invoices/${invoiceId}/pdf`, {
          credentials: "include",
        });

        if (response.ok) {
          const data = await response.json();
          if (data.pdfUrl) {
            const printWindow = window.open(data.pdfUrl, "_blank");
            if (printWindow) {
              printWindow.onload = () => {
                printWindow.print();
              };
            }
            toast({
              title: "Print",
              description: "Opening PDF for printing...",
            });
          } else {
            toast({
              title: "PDF Not Available",
              description: "Generate the PDF first before printing",
              variant: "destructive",
            });
          }
        }
      } catch {
        toast({
          title: "Error",
          description: "Failed to print invoice",
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  const emailInvoice = useCallback(
    async (invoiceId: string, customerEmail: string, invoiceNumber: string) => {
      try {
        const response = await apiFetch(`/api/invoices/${invoiceId}/pdf`, {
          credentials: "include",
        });

        if (response.ok) {
          const data = await response.json();
          if (data.pdfUrl) {
            const subject = encodeURIComponent(`Invoice ${invoiceNumber} from Viger Assist Ltd`);
            const body = encodeURIComponent(
              `Dear Customer,\n\nPlease find your invoice attached:\n${data.pdfUrl}\n\nThank you for your business.\n\nBest regards,\nViger Assist Ltd`
            );
            window.open(`mailto:${customerEmail}?subject=${subject}&body=${body}`, "_blank");
            toast({
              title: "Email Client Opened",
              description: `Composing email to ${customerEmail}`,
            });
          } else {
            toast({
              title: "PDF Not Available",
              description: "Generate the PDF first before emailing",
              variant: "destructive",
            });
          }
        }
      } catch {
        toast({
          title: "Error",
          description: "Failed to prepare email",
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  const copyInvoiceLink = useCallback(
    async (invoiceId: string, invoiceNumber: string) => {
      try {
        const response = await apiFetch(`/api/invoices/${invoiceId}/pdf`, {
          credentials: "include",
        });

        if (response.ok) {
          const data = await response.json();
          if (data.pdfUrl) {
            await navigator.clipboard.writeText(data.pdfUrl);
            toast({
              title: "Link Copied",
              description: "Invoice PDF link copied to clipboard",
            });
          } else {
            toast({
              title: "No Link Available",
              description: "PDF has not been generated yet",
              variant: "destructive",
            });
          }
        }
      } catch {
        toast({
          title: "Error",
          description: "Failed to copy link",
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  const regenerateAllMissing = useCallback(async () => {
    setRegenerating(true);
    try {
      const response = await apiRequest("POST", "/api/invoices/regenerate-all-missing");
      const data = await response.json();

      toast({
        title: "PDFs Generated",
        description: data.message,
      });

      await invalidateAfterInvoiceRegeneration(queryClient);
    } catch {
      toast({
        title: "Error",
        description: "Failed to regenerate PDFs",
        variant: "destructive",
      });
    } finally {
      setRegenerating(false);
    }
  }, [toast]);

  if (invoicesInitialLoad) {
    return <InvoicesPageSkeleton />;
  }

  return (
    <div className="w-full">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <AppPageHeader
          title="Invoices"
          description="Totals follow your status, search, and date window. PDF actions need a generated file on the server first."
          icon={<FileText className="h-7 w-7 shrink-0 text-muted-foreground sm:h-8 sm:w-8" />}
          trailing={
            invoicesFetching ? (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                Refreshing invoices…
              </p>
            ) : undefined
          }
        />

        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Paid total</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl font-bold tabular-nums tracking-tight">
                £{(isNaN(totalRevenue) ? 0 : totalRevenue).toFixed(2)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Paid rows in current filter</p>
            </CardContent>
          </Card>
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl font-bold tabular-nums tracking-tight">
                £{(isNaN(pendingRevenue) ? 0 : pendingRevenue).toFixed(2)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Awaiting payment</p>
            </CardContent>
          </Card>
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Overdue</CardTitle>
              <AlertCircle className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl font-bold tabular-nums tracking-tight text-destructive">
                £{(isNaN(overdueRevenue) ? 0 : overdueRevenue).toFixed(2)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Past due date</p>
            </CardContent>
          </Card>
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Rows shown</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl font-bold tabular-nums tracking-tight">{filteredInvoices.length}</div>
              <p className="mt-1 text-xs text-muted-foreground">After search, status, and date window</p>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-8 border-border/60 bg-muted/[0.04] shadow-sm">
          <CardContent className="flex flex-col gap-4 p-4 sm:p-5 sm:pt-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by #, name, or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="min-h-[44px] pl-8"
                data-testid="input-search-invoices"
              />
            </div>
            <Select value={filterStatus} onValueChange={(value: "all" | "paid" | "pending" | "overdue") => setFilterStatus(value)}>
              <SelectTrigger className="min-h-[44px] w-full sm:w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedPeriod} onValueChange={(value: "all" | "today" | "week" | "month") => setSelectedPeriod(value)}>
              <SelectTrigger className="min-h-[44px] w-full sm:w-[160px]">
                <SelectValue placeholder="Date window" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All dates</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This week</SelectItem>
                <SelectItem value="month">This month</SelectItem>
              </SelectContent>
            </Select>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end lg:w-auto">
            <Button
              variant="outline"
              className="min-h-[44px] gap-2 border-destructive/25 text-destructive hover:bg-destructive/10 sm:flex-none"
              onClick={regenerateAllMissing}
              disabled={regenerating}
              data-testid="button-regenerate-pdfs"
            >
              {regenerating ? (
                <>
                  <ActionLoader className="text-destructive" />
                  Generating…
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4" />
                  Generate missing PDFs
                </>
              )}
            </Button>
            <Button className="min-h-[44px] gap-2 sm:flex-none" data-testid="button-create-invoice">
              <FileText className="h-4 w-4" />
              Create invoice
            </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="space-y-2 pb-3">
            <CardTitle className="text-lg">Invoice list</CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              Status and dates first; amounts use tabular figures. PDF menu: open, print, copy link, or draft an email.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {filteredInvoices.length === 0 ? (
              invoices.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No invoices yet"
                  body="Created invoices will appear here after you bill customers from orders or create them manually."
                  cta={{ label: "View orders", href: "/open-orders" }}
                  secondary={{ label: "Manage customers", href: "/customers" }}
                />
              ) : periodInvoices.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="Nothing in this date window"
                  body="Widen the period (for example All dates or This month) to see invoices outside the current range."
                />
              ) : searchTerm.trim() ? (
                <EmptyState
                  icon={Search}
                  title="No invoices match your search"
                  body="Try another invoice number, customer name, or email—or clear the search field."
                />
              ) : (
                <EmptyState
                  icon={FileText}
                  title="No invoices match these filters"
                  body="Set status to All statuses, choose a wider date window, or clear the search to see more rows."
                />
              )
            ) : (
              <DataTableShell className="overflow-x-auto">
                <Table scrollContainerClassName="overflow-visible">
                  <TableHeader>
                    <TableRow className="border-b bg-muted/40 hover:bg-muted/40">
                      <TableHead className="whitespace-nowrap">Invoice #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="whitespace-nowrap">Issued</TableHead>
                      <TableHead className="whitespace-nowrap">Due</TableHead>
                      <TableHead className="whitespace-nowrap text-right">Total</TableHead>
                      <TableHead className="whitespace-nowrap">Status</TableHead>
                      <TableHead className="whitespace-nowrap">Payment</TableHead>
                      <TableHead className="whitespace-nowrap text-right">PDF</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoices.map((invoice) => (
                      <InvoiceRow
                        key={invoice.id}
                        invoice={invoice}
                        onCopyInvoiceNumber={copyInvoiceNumber}
                        onViewPdf={viewInvoicePdf}
                        onPrint={printInvoice}
                        onCopyLink={copyInvoiceLink}
                        onEmail={emailInvoice}
                      />
                    ))}
                  </TableBody>
                </Table>
              </DataTableShell>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
