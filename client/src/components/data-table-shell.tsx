import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { EmptyState, type EmptyStateProps } from "@/components/EmptyState";

/** Consistent frame around tables (scroll lives on the inner Table wrapper). */
export function DataTableShell({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("overflow-hidden rounded-lg border border-border/80 bg-card shadow-sm", className)}
      {...props}
    />
  );
}

/** Scroll region for long tables; use with sticky TableHeader. */
export function DataTableScrollRegion({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "max-h-[min(380px,52vh)] overflow-auto rounded-lg border border-border/80 bg-card shadow-sm",
        className
      )}
      {...props}
    />
  );
}

/**
 * Standardised table states (Component Spec — Phase 4): one consistent way to
 * render loading → error → empty → content, so no page hand-rolls its own.
 *
 * - Loading: skeleton rows (reduced-motion aware).
 * - Error: an EmptyState that says what happened, why, and offers a retry.
 * - Empty: the supplied EmptyState (what / why / what next — never "No data").
 * - Otherwise: the table content.
 */
export type DataTableStateProps = {
  isLoading?: boolean;
  error?: unknown;
  isEmpty?: boolean;
  /** Empty state: what happened, why, and the first move. */
  empty: EmptyStateProps;
  /** Optional retry handler for the error state. */
  onRetry?: () => void;
  /** Number of skeleton rows while loading. */
  loadingRows?: number;
  children: ReactNode;
};

export function DataTableState({
  isLoading,
  error,
  isEmpty,
  empty,
  onRetry,
  loadingRows = 5,
  children,
}: DataTableStateProps) {
  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-busy="true" aria-live="polite">
        <Skeleton variant="row" count={loadingRows} />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        title="Couldn't load this"
        body="Something went wrong fetching the data. Check your connection and try again."
        cta={onRetry ? { label: "Try again", onClick: onRetry } : undefined}
      />
    );
  }

  if (isEmpty) {
    return <EmptyState {...empty} />;
  }

  return <>{children}</>;
}
