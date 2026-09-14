import * as React from "react";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableHeader } from "@/components/ui/table";

/**
 * Shared phone-usability convention for wide data tables (ARC-054 / ARC-034).
 *
 * A data table with many columns is unreadable — and its action column often
 * unreachable without discovering horizontal scroll — on a ~390px phone.
 * `ResponsiveTable` keeps the existing desktop `<Table>` markup untouched
 * (hidden below `md:`) and renders a caller-supplied card per row below it
 * (shown only below `md:`), matching the pattern already used on the Credit
 * List page (`client/src/pages/tick-list.tsx`).
 *
 * Desktop markup (columns, sorting handlers, per-cell formatting) stays in
 * the caller as plain `<TableRow>` children, so this stays a thin structural
 * wrapper rather than a rigid column schema — pages keep full control of
 * both views while sharing one convention instead of inventing their own.
 */
export interface ResponsiveTableProps<T> {
  /** Desktop `<TableHeader>` content — typically one `<TableRow>` of `<TableHead>`s. */
  head: React.ReactNode;
  /** Desktop `<TableBody>` content — one `<TableRow>` per row, exactly as a plain table would render it. */
  children: React.ReactNode;
  /** Rows backing the mobile card list. */
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  /**
   * Renders one row as a mobile card. Put the primary/identifying value
   * first, secondary fields as label:value lines (see `ResponsiveCardRow`),
   * and any row actions as full-width buttons at the end so they're never
   * the thing hidden behind a scroll a user didn't know was there.
   */
  renderCard: (row: T, index: number) => React.ReactNode;
  className?: string;
  tableClassName?: string;
  cardListClassName?: string;
}

export function ResponsiveTable<T>({
  head,
  children,
  rows,
  getRowKey,
  renderCard,
  className,
  tableClassName,
  cardListClassName,
}: ResponsiveTableProps<T>) {
  return (
    <div className={className}>
      <div className="hidden md:block">
        <Table className={tableClassName}>
          <TableHeader>{head}</TableHeader>
          <TableBody>{children}</TableBody>
        </Table>
      </div>
      <div className={cn("space-y-3 md:hidden", cardListClassName)}>
        {rows.map((row, i) => (
          <React.Fragment key={getRowKey(row, i)}>{renderCard(row, i)}</React.Fragment>
        ))}
      </div>
    </div>
  );
}

/** A "Label ⋯ value" line for hand-built mobile cards — keeps card body markup consistent. */
export function ResponsiveCardRow({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-0.5 text-sm", className)}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium">{children}</span>
    </div>
  );
}
