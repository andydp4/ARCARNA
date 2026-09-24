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
import { apiRequest } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TableHead, TableRow } from "@/components/ui/table";
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
import { InvoiceRow, InvoiceCard, type InvoiceListItem } from "@/components/invoice-row";
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS, type InvoiceStatus } from "@shared/invoices/invoiceRules";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { InvoicesPageSkeleton } from "@/components/reporting-skeletons";
import { PageHeader } from "@/components/PageHeader";
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
  const [filterStatus, setFilterStatus] = useState<"all" | InvoiceStatus>("all");
  const [selectedPeriod, setSelectedPeriod] = useState<"all" | "today" | "week" | "month">("month");

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

  // One rule for every figure (v1.2 Phase 1C): owed and overdue are what is
  // still to pay, so a part-paid invoice counts only its remainder.
  const { totalRevenue, pendingRevenue, overdueRevenue } = useMemo(() => {
    let paid = 0;
    let owed = 0;
    let overdue = 0;
    for (const inv of filteredInvoices) {
      if (inv.status === "paid") paid += inv.total;
      else if (inv.status === "owed" || inv.status === "part-paid") owed += inv.amountDue;
      else if (inv.status === "overdue") overdue += inv.amountDue;
    }
    return { totalRevenue: paid, pendingRevenue: owed, overdueRevenue: overdue };
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

  /** Fetches the invoice PDF (generated on demand server-side) as a blob. */
  const fetchInvoicePdfBlob = useCallback(async (invoiceId: string): Promise<Blob | null> => {
    const response = await apiFetch(`/api/invoices/${invoiceId}/pdf`, {
      credentials: "include",
    });
    if (!response.ok) return null;
    return response.blob();
  }, []);

  const viewInvoicePdf = useCallback(
    async (invoiceId: string, invoiceNumber: string) => {
      try {
        const blob = await fetchInvoicePdfBlob(invoiceId);
        if (!blob) {
          toast({ title: "Error", description: "Could not generate invoice PDF", variant: "destructive" });
          return;
        }
        window.open(URL.createObjectURL(blob), "_blank");
      } catch {
        toast({ title: "Error", description: "Failed to get invoice PDF", variant: "destructive" });
      }
    },
    [fetchInvoicePdfBlob, toast]
  );

  const printInvoice = useCallback(
    async (invoiceId: string, invoiceNumber: string) => {
      try {
        const blob = await fetchInvoicePdfBlob(invoiceId);
        if (!blob) {
          toast({ title: "Error", description: "Could not generate invoice PDF", variant: "destructive" });
          return;
        }
        const printWindow = window.open(URL.createObjectURL(blob), "_blank");
        if (printWindow) {
          printWindow.onload = () => printWindow.print();
        }
        toast({ title: "Print", description: "Opening PDF for printing…" });
      } catch {
        toast({ title: "Error", description: "Failed to print invoice", variant: "destructive" });
      }
    },
    [fetchInvoicePdfBlob, toast]
  );

  const downloadInvoicePdf = useCallback(
    async (invoiceId: string, invoiceNumber: string) => {
      try {
        const blob = await fetchInvoicePdfBlob(invoiceId);
        if (!blob) {
          toast({ title: "Error", description: "Could not generate invoice PDF", variant: "destructive" });
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${invoiceNumber}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: "Downloaded", description: `${invoiceNumber}.pdf saved to your device` });
      } catch {
        toast({ title: "Error", description: "Failed to download invoice", variant: "destructive" });
      }
    },
    [fetchInvoicePdfBlob, toast]
  );

  // Invoices are emailed from the server through Resend (v1.2 Phase 6,
  // PRV-11): nobody on the till needs the customer's address. When email is
  // not set up the menu item is off and says why.
  const { data: messaging } = useQuery<{ email: boolean; emailReason: string | null }>({
    queryKey: ["/api/messaging/status"],
    staleTime: 60_000,
  });
  const emailInvoice = useCallback(
    async (invoiceId: string, _customerEmail: string, invoiceNumber: string) => {
      try {
        const res = await apiRequest("POST", `/api/invoices/${invoiceId}/email`);
        const out = (await res.json()) as { to?: string | null };
        toast({ title: "Invoice emailed", description: `${invoiceNumber} sent${out.to ? ` to ${out.to}` : ""}.` });
      } catch (e) {
        toast({ title: "Not sent", description: e instanceof Error ? e.message : "Failed to email the invoice", variant: "destructive" });
      }
    },
    [toast]
  );

  if (invoicesInitialLoad) {
    return <InvoicesPageSkeleton />;
  }

  return (
    <div className="w-full">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <PageHeader
          icon={FileText}
          title="Invoices"
          question="Who owes you, and is it paid?"
          explanation="Till sales get receipts. An invoice is issued when a sale goes on a tab, or when a customer asks for one from the order. Totals follow your status, search, and date window."
          action={
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
              <CardTitle className="text-sm font-medium text-muted-foreground">Owed</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl font-bold tabular-nums tracking-tight">
                £{(isNaN(pendingRevenue) ? 0 : pendingRevenue).toFixed(2)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Still to pay, not yet due</p>
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
              <p className="mt-1 text-xs text-muted-foreground">Still to pay, past due date</p>
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
            <Select value={filterStatus} onValueChange={(value: "all" | InvoiceStatus) => setFilterStatus(value)}>
              <SelectTrigger className="min-h-[44px] w-full sm:w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {INVOICE_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {INVOICE_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
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
            {/* No "Create invoice" action here: an invoice is raised when a
                sale goes on a tab, or from the order itself when a customer
                asks (its "Invoice" button). */}
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
                  body="Till sales get receipts. Invoices appear here when a sale goes on a tab, or when a customer asks for one from the order."
                  cta={{ label: "View orders", href: "/operations" }}
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
                <ResponsiveTable
                  rows={filteredInvoices}
                  getRowKey={(invoice) => invoice.id}
                  tableClassName="overflow-visible"
                  cardListClassName="p-3"
                  head={
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
                  }
                  renderCard={(invoice) => (
                    <InvoiceCard
                      invoice={invoice}
                      onCopyInvoiceNumber={copyInvoiceNumber}
                      onViewPdf={viewInvoicePdf}
                      onPrint={printInvoice}
                      onDownload={downloadInvoicePdf}
                      onEmail={emailInvoice}
                      emailDisabledReason={messaging && !messaging.email ? messaging.emailReason : null}
                    />
                  )}
                >
                  {filteredInvoices.map((invoice) => (
                    <InvoiceRow
                      key={invoice.id}
                      invoice={invoice}
                      onCopyInvoiceNumber={copyInvoiceNumber}
                      onViewPdf={viewInvoicePdf}
                      onPrint={printInvoice}
                      onDownload={downloadInvoicePdf}
                      onEmail={emailInvoice}
                      emailDisabledReason={messaging && !messaging.email ? messaging.emailReason : null}
                    />
                  ))}
                </ResponsiveTable>
              </DataTableShell>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
