import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowDown, ArrowRight, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * InsightCard (Component Spec — Phase 4): the canonical information card for Arcarna.
 *
 * Data-driven, not business-specific. One component represents every kind of
 * insight; the `type` selects a semantic accent (token-driven, never hardcoded):
 *
 *   truth          → Truth Blue   (a revealed fact)
 *   recommendation → Truth Blue   (a Next Move / AI insight)
 *   opportunity    → Success
 *   success        → Success
 *   risk           → Danger
 *   watchlist      → Warning
 *
 * Every card answers: What is this? (type + title) · What's the value? (value) ·
 * Why does it matter? (explanation + trend) · What next? (action).
 */

export type InsightType =
  | "truth"
  | "opportunity"
  | "risk"
  | "watchlist"
  | "success"
  | "recommendation";

export type InsightTrend = {
  /** Direction drives the arrow and the state colour. */
  direction: "up" | "down" | "flat";
  /** Short label, e.g. "+8% vs yesterday". */
  label: string;
  /** When true, "up" is bad (e.g. refunds, costs) and the colour inverts. */
  invert?: boolean;
};

export type InsightAction = {
  label: string;
  href?: string;
  onClick?: () => void;
};

export type InsightCardProps = {
  /** Selects the semantic accent. Defaults to "truth". */
  type?: InsightType;
  /** What is this? */
  title: string;
  /** The number or state (optional for narrative insights). */
  value?: ReactNode;
  /** Why does it matter? One short sentence. */
  explanation?: string;
  /** Optional trend vs a comparison window. */
  trend?: InsightTrend;
  /** Optional recommended next move. */
  action?: InsightAction;
  /** Optional leading icon. */
  icon?: LucideIcon;
  /** Optional footer (e.g. source, timestamp). */
  footer?: ReactNode;
  className?: string;
  "data-testid"?: string;
};

type Accent = { bar: string; fg: string; label: string };

const ACCENT: Record<InsightType, Accent> = {
  truth: { bar: "bg-truth", fg: "text-truth-bright", label: "Truth" },
  recommendation: { bar: "bg-truth", fg: "text-truth-bright", label: "Recommendation" },
  opportunity: { bar: "bg-success", fg: "text-success", label: "Opportunity" },
  success: { bar: "bg-success", fg: "text-success", label: "Success" },
  risk: { bar: "bg-danger", fg: "text-danger", label: "Risk" },
  watchlist: { bar: "bg-warning", fg: "text-warning", label: "Watchlist" },
};

function TrendRow({ trend }: { trend: InsightTrend }) {
  const good = trend.invert ? trend.direction === "down" : trend.direction === "up";
  const bad = trend.invert ? trend.direction === "up" : trend.direction === "down";
  const Icon = trend.direction === "up" ? ArrowUp : trend.direction === "down" ? ArrowDown : Minus;
  const color = good ? "text-success" : bad ? "text-danger" : "text-metal-muted";
  return (
    <div className={cn("mt-2 flex items-center gap-1 text-sm font-medium", color)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{trend.label}</span>
    </div>
  );
}

function ActionLink({ action }: { action: InsightAction }) {
  const className =
    "mt-3 inline-flex items-center gap-1 text-sm font-medium text-truth-bright hover:underline";
  const content = (
    <>
      {action.label}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </>
  );
  if (action.href) {
    return (
      <Link href={action.href} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={className}>
      {content}
    </button>
  );
}

export function InsightCard({
  type = "truth",
  title,
  value,
  explanation,
  trend,
  action,
  icon: Icon,
  footer,
  className,
  ...rest
}: InsightCardProps) {
  const accent = ACCENT[type];
  const hasValue = value !== undefined && value !== null && value !== "";

  return (
    <article
      className={cn("lm-card relative overflow-hidden rounded-xl p-5 sm:p-6", className)}
      data-insight-type={type}
      data-testid={rest["data-testid"]}
    >
      {/* Type accent — semantic token, also conveyed by the label (never colour alone). */}
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", accent.bar)} />

      <div className="flex items-center gap-1.5">
        {Icon ? <Icon className={cn("h-4 w-4 shrink-0", accent.fg)} aria-hidden /> : null}
        <span className={cn("text-xs font-medium uppercase tracking-wide", accent.fg)}>
          {accent.label}
        </span>
      </div>

      {hasValue ? (
        <>
          <p className="mt-1.5 text-sm font-medium text-metal-muted">{title}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums text-metal-warm-white">
            {value}
          </p>
        </>
      ) : (
        <h3 className="mt-1.5 text-base font-semibold leading-snug text-metal-warm-white">{title}</h3>
      )}

      {trend ? <TrendRow trend={trend} /> : null}

      {explanation ? (
        <p className="mt-2 text-sm leading-relaxed text-metal-muted">{explanation}</p>
      ) : null}

      {action ? <ActionLink action={action} /> : null}

      {footer ? (
        <div className="mt-4 border-t border-border pt-3 text-xs text-metal-muted">{footer}</div>
      ) : null}
    </article>
  );
}
