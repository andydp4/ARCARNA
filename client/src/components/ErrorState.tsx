/**
 * ARC-031: a chart/card whose fetch genuinely failed used to render its
 * `isLoading`-false, `data`-undefined branch — visually identical to "no
 * activity in this period" — which reads to a business owner as "there were
 * no sales" instead of "something is broken and this number is not to be
 * trusted". Any card driven by react-query should check `isError` before
 * falling through to its empty state, and render this instead.
 *
 * Sibling to EmptyState (same shape, same slot in a card) but visually
 * distinct — a warning tone and a Retry action instead of a CTA — so the two
 * are never confusable at a glance.
 */
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ErrorStateProps = {
  title?: string;
  body?: string;
  /** Refetch handler — pass a react-query `refetch`. Omit to hide the button (e.g. no retry makes sense). */
  onRetry?: () => void;
  icon?: LucideIcon;
  className?: string;
  "data-testid"?: string;
};

/**
 * Designed error state for a card/chart whose data fetch failed. Renders in
 * the same slot an EmptyState or the real content would occupy.
 */
export function ErrorState({
  title = "Couldn't load this",
  body = "Something went wrong fetching this data. Your other numbers may still be fine — this one just isn't loaded.",
  onRetry,
  icon: Icon = AlertTriangle,
  className,
  "data-testid": dataTestId,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "mx-auto max-w-md rounded-xl border border-dashed border-danger lm-card-muted px-6 py-10 text-center",
        className,
      )}
      role="alert"
      data-testid={dataTestId}
    >
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-metal-charcoal ring-1 ring-danger">
        <Icon className="h-8 w-8 text-danger" aria-hidden />
      </div>
      <p className="text-base font-semibold text-metal-warm-white">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-metal-muted">{body}</p>
      {onRetry && (
        <div className="mt-6 flex justify-center">
          <Button type="button" variant="outline" className="min-h-[44px] lm-btn-outline gap-2" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
