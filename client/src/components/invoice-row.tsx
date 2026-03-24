import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  Calendar,
  Copy,
  Eye,
  Printer,
  Mail,
  Link2,
  ChevronDown,
  CheckCircle,
  Clock,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerEmail: string;
  date: string;
  dueDate: string;
  total: number;
  status: "paid" | "pending" | "overdue" | "cancelled";
  paymentMethod: string;
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const variants = {
    paid: { color: "default" as const, icon: CheckCircle },
    pending: { color: "secondary" as const, icon: Clock },
    overdue: { color: "destructive" as const, icon: AlertCircle },
    cancelled: { color: "outline" as const, icon: AlertCircle },
  };

  const variant = variants[status as keyof typeof variants];
  const Icon = variant.icon;

  return (
    <Badge
      variant={variant.color}
      className={cn(
        "shrink-0 gap-1 font-medium",
        status === "pending" && "ring-2 ring-amber-400/40",
        status === "overdue" && "ring-2 ring-destructive/30"
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

export type InvoiceRowProps = {
  invoice: InvoiceListItem;
  onCopyInvoiceNumber: (invoiceNumber: string) => void;
  onViewPdf: (invoiceId: string, invoiceNumber: string) => void;
  onPrint: (invoiceId: string, invoiceNumber: string) => void;
  onCopyLink: (invoiceId: string, invoiceNumber: string) => void;
  onEmail: (invoiceId: string, customerEmail: string, invoiceNumber: string) => void;
};

function InvoiceRowInner({
  invoice,
  onCopyInvoiceNumber,
  onViewPdf,
  onPrint,
  onCopyLink,
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
          <div className="truncate text-xs text-muted-foreground">{invoice.customerEmail}</div>
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
        <span className="text-base font-semibold tracking-tight">£{invoice.total.toFixed(2)}</span>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <InvoiceStatusBadge status={invoice.status} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <Badge variant="outline" className="font-normal capitalize text-muted-foreground">
          {invoice.paymentMethod || "—"}
        </Badge>
      </TableCell>
      <TableCell className="w-[1%] whitespace-nowrap text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="min-h-10 min-w-[4.5rem] gap-1"
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
              onClick={() => onCopyLink(invoice.id, invoice.invoiceNumber)}
              data-testid={`button-link-${invoice.id}`}
            >
              <Link2 className="mr-2 h-4 w-4" />
              Copy PDF link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onEmail(invoice.id, invoice.customerEmail, invoice.invoiceNumber)}
              data-testid={`button-email-${invoice.id}`}
            >
              <Mail className="mr-2 h-4 w-4" />
              Draft email with link
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
    prev.onCopyLink === next.onCopyLink &&
    prev.onEmail === next.onEmail
);
