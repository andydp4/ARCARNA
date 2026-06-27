import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ChartCard (Component Spec — Phase 6): the canonical frame for every chart.
 *
 * A chart never just displays data. It answers:
 *   Question      → what are we asking?
 *   [chart]       → the evidence
 *   Interpretation→ what the data is telling you
 *   Recommended   → the next move (Truth Blue)
 *
 * Surface: refined Liquid Metal (`lm-card`). Use Truth Blue for the insight
 * series and semantic colours only for meaning.
 */
export type ChartAction = {
  label: string;
  href?: string;
  onClick?: () => void;
};

export type ChartCardProps = {
  title: string;
  /** The question this chart answers. */
  question?: string;
  /** Optional right-of-header content (e.g. range toggles). */
  aside?: ReactNode;
  /** The chart. */
  children: ReactNode;
  /** Interpretation — what the data is telling you. */
  interpretation?: ReactNode;
  /** Recommended next move. */
  action?: ChartAction;
  className?: string;
};

function RecommendedAction({ action }: { action: ChartAction }) {
  const className =
    "inline-flex items-center gap-1 text-sm font-medium text-truth-bright hover:underline";
  const content = (
    <>
      {action.label}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </>
  );
  return (
    <div className="mt-3">
      {action.href ? (
        <Link href={action.href} className={className}>
          {content}
        </Link>
      ) : (
        <button type="button" onClick={action.onClick} className={className}>
          {content}
        </button>
      )}
    </div>
  );
}

export function ChartCard({
  title,
  question,
  aside,
  children,
  interpretation,
  action,
  className,
}: ChartCardProps) {
  return (
    <section className={cn("lm-card rounded-xl p-5 sm:p-6", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-metal-warm-white">{title}</h3>
          {question ? <p className="mt-0.5 text-sm text-metal-muted">{question}</p> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>

      {children}

      {interpretation ? (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-metal-muted">
            Interpretation
          </p>
          <p className="mt-1 text-sm leading-relaxed text-metal-warm-white">{interpretation}</p>
        </div>
      ) : null}

      {action ? <RecommendedAction action={action} /> : null}
    </section>
  );
}
