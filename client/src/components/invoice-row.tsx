import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";
import { ResponsiveCardRow } from "@/components/ui/responsive-table";
import {
  Calendar,
  Copy,
  Eye,
  Printer,
  Mail,
  Download,
  ChevronDown,
  CheckCircle,
  Clock,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPaymentLabel } from "@/lib/paymentLabel";
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from "@shared/invoices/invoiceRules";

export interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerEmail: string;
  /** j•••@gmail.com: what a manager sees (v1.2 Phase 5, Q7). */
  customerEmailMasked?: string | null;
  date: string;
  dueDate: string;
  total: number;
  /** Still to pay, under the same rule as the status. */
  amountDue: number;
  status: InvoiceStatus;
  paymentMethod: string;
}

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const variants: Record<InvoiceStatus, { color: "default" | "secondary" | "destructive" | "outline"; icon: typeof CheckCircle }> = {
    paid: { color: "default", icon: CheckCircle },
    "part-paid": { color: "secondary", icon: Clock },
    owed: { color: "secondary", icon: Clock },
    overdue: { color: "destructive", icon: AlertCircle },
    void: { color: "outline", icon: AlertCircle },
  };

  const variant = variants[status] ?? variants.owed;
  const Icon = variant.icon;

  return (
    <Badge
      variant={variant.color}
      className={cn(
        "shrink-0 gap-1 font-medium",
        (status === "owed" || status === "part-paid") && "ring-2 ring-amber-400/40",
        status === "overdue" && "ring-2 ring-destructive/30"
      )}
      data-testid={`invoice-status-${status}`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {INVOICE_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

/** Total, and what is still to pay when that is less. */
function InvoiceAmount({ invoice }: { invoice: InvoiceListItem }) {
  const showsDue = invoice.amountDue > 0 && invoice.amountDue !== invoice.total;
  return (
    <span className="inline-flex flex-col items-end">
      <span className="text-base font-semibold tracking-tight">£{invoice.total.toFixed(2)}</span>
      {showsDue && (
        <span className="text-xs text-muted-foreground">£{invoice.amountDue.toFixed(2)} to pay</span>
      )}
    </span>
  );
}

export type InvoiceRowProps = {
  invoice: InvoiceListItem;
  onCopyInvoiceNumber: (invoiceNumber: string) => void;
  onViewPdf: (invoiceId: string, invoiceNumber: string) => void;
  onPrint: (invoiceId: string, invoiceNumber: string) => void;
  onDownload: (invoiceId: string, invoiceNumber: string) => void;
  onEmail: (invoiceId: string, customerEmail: string, invoiceNumber: string) => void;
};

/** The PDF actions menu, shared between the desktop row and the mobile card. */
function InvoicePdfMenu({
  invoice,
  onViewPdf,
  onPrint,
  onDownload,
  onEmail,
  className,
}: Pick<InvoiceRowProps, "invoice" | "onViewPdf" | "onPrint" | "onDownload" | "onEmail"> & {
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("min-h-10 min-w-[4.5rem] gap-1", className)}
          data-testid={`button-pdf-menu-${invoice.id}`}
        >
          PDF
          <ChevronDown className="h-4 w-4 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {invoice.invoiceNumber}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onViewPdf(invoice.id, invoice.invoiceNumber)}
          data-testid={`button-view-${invoice.id}`}
        >
          <Eye className="mr-2 h-4 w-4" />
          Open PDF (new tab)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onPrint(invoice.id, invoice.invoiceNumber)}
          data-testid={`button-print-${invoice.id}`}
        >
          <Printer className="mr-2 h-4 w-4" />
          Print via browser
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onDownload(invoice.id, invoice.invoiceNumber)}
          data-testid={`button-download-${invoice.id}`}
        >
          <Download className="mr-2 h-4 w-4" />
          Download PDF
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onEmail(invoice.id, invoice.customerEmail, invoice.invoiceNumber)}
          data-testid={`button-email-${invoice.id}`}
        >
          <Mail className="mr-2 h-4 w-4" />
          Download & email invoice
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InvoiceRowInner({
  invoice,
  onCopyInvoiceNumber,
  onViewPdf,
  onPrint,
  onDownload,
  onEmail,
}: InvoiceRowProps) {
  return (
    <TableRow className="group align-middle">
      <TableCell className="min-w-[7.5rem] max-w-[11rem] font-medium">
        <div className="flex items-center gap-1">
          <span className="truncate tabular-nums text-sm font-semibold tracking-tight">
            {invoice.invoiceNumber}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 hover:text-foreground"
            onClick={() => onCopyInvoiceNumber(invoice.invoiceNumber)}
            aria-label={`Copy invoice number ${invoice.invoiceNumber}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
      <TableCell className="min-w-0 max-w-[14rem] lg:max-w-[18rem]">
        <div className="text-sm leading-snug">
          <div className="truncate font-medium text-foreground">{invoice.customerName}</div>
          <div className="truncate text-xs text-muted-foreground">{invoice.customerEmail || invoice.customerEmailMasked}</div>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 text-sm">
          <Calendar className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          {new Date(invoice.date).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums text-sm text-muted-foreground">
        {new Date(invoice.dueDate).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        <InvoiceAmount invoice={invoice} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <InvoiceStatusBadge status={invoice.status} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <Badge variant="outline" className="font-normal text-muted-foreground">
          {formatPaymentLabel(invoice.paymentMethod)}
        </Badge>
      </TableCell>
      <TableCell className="w-[1%] whitespace-nowrap text-right">
        <InvoicePdfMenu
          invoice={invoice}
          onViewPdf={onViewPdf}
          onPrint={onPrint}
          onDownload={onDownload}
          onEmail={onEmail}
        />
      </TableCell>
    </TableRow>
  );
}

export const InvoiceRow = memo(
  InvoiceRowInner,
  (prev, next) =>
    prev.invoice === next.invoice &&
    prev.onCopyInvoiceNumber === next.onCopyInvoiceNumber &&
    prev.onViewPdf === next.onViewPdf &&
    prev.onPrint === next.onPrint &&
    prev.onDownload === next.onDownload &&
    prev.onEmail === next.onEmail
);

/**
 * Phone card for the same row (ARC-054 / ARC-034) — the PDF actions menu is
 * the only interactive part of this row, so it gets a full-width button
 * instead of being the thing a phone user has to discover by scrolling a
 * wide table sideways.
 */
function InvoiceCardInner({
  invoice,
  onCopyInvoiceNumber,
  onViewPdf,
  onPrint,
  onDownload,
  onEmail,
}: InvoiceRowProps) {
  return (
    <Card className="border-border/60 shadow-sm" data-testid={`card-invoice-${invoice.id}`}>
      <CardContent className="pt-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate tabular-nums text-sm font-semibold tracking-tight">
              {invoice.invoiceNumber}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground"
              onClick={() => onCopyInvoiceNumber(invoice.invoiceNumber)}
              aria-label={`Copy invoice number ${invoice.invoiceNumber}`}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <InvoiceStatusBadge status={invoice.status} />
        </div>

        <div className="text-sm leading-snug">
          <div className="truncate font-medium text-foreground">{invoice.customerName}</div>
          <div className="truncate text-xs text-muted-foreground">{invoice.customerEmail || invoice.customerEmailMasked}</div>
        </div>

        <div className="mt-2 space-y-1 border-t pt-2">
          <ResponsiveCardRow label="Issued">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              {new Date(invoice.date).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </ResponsiveCardRow>
          <ResponsiveCardRow label="Due">
            {new Date(invoice.dueDate).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </ResponsiveCardRow>
          <ResponsiveCardRow label="Payment">
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {formatPaymentLabel(invoice.paymentMethod)}
            </Badge>
          </ResponsiveCardRow>
          <ResponsiveCardRow label="Total">
            <InvoiceAmount invoice={invoice} />
          </ResponsiveCardRow>
        </div>

        <InvoicePdfMenu
          invoice={invoice}
          onViewPdf={onViewPdf}
          onPrint={onPrint}
          onDownload={onDownload}
          onEmail={onEmail}
          className="mt-3 min-h-[44px] w-full justify-center"
        />
      </CardContent>
    </Card>
  );
}

export const InvoiceCard = memo(
  InvoiceCardInner,
  (prev, next) =>
    prev.invoice === next.invoice &&
    prev.onCopyInvoiceNumber === next.onCopyInvoiceNumber &&
    prev.onViewPdf === next.onViewPdf &&
    prev.onPrint === next.onPrint &&
    prev.onDownload === next.onDownload &&
    prev.onEmail === next.onEmail
);
