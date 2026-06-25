import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowDown, ArrowRight, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Business Truth Card (Component Spec — Phase 4).
 *
 * A truth is not a bare number. Every card answers:
 *   What is this?  → title
 *   What's the value? → value
 *   Why does it matter? → meaning (+ optional trend)
 *   What can I do next? → optional action (a Next Move)
 *
 * Surface: refined Liquid Metal (`lm-card`). Accent: Truth Blue (action).
 * State colours (success/danger) are used only for the trend's meaning.
 */

export type TruthTrend = {
  /** Direction drives the arrow and the state colour. */
  direction: "up" | "down" | "flat";
  /** Short label, e.g. "+8% vs yesterday". */
  label: string;
  /** When true, "up" is bad (e.g. refunds, costs) and the colour inverts. */
  invert?: boolean;
};

export type TruthAction = {
  label: string;
  href?: string;
  onClick?: () => void;
};

export type BusinessTruthCardProps = {
  /** What is this? */
  title: string;
  /** The number or state. */
  value: ReactNode;
  /** Why does it matter? One short sentence. */
  meaning?: string;
  /** Optional trend vs a comparison window. */
  trend?: TruthTrend;
  /** Optional recommended next move. */
  action?: TruthAction;
  icon?: LucideIcon;
  className?: string;
  "data-testid"?: string;
};

function TrendRow({ trend }: { trend: TruthTrend }) {
  const good = trend.invert ? trend.direction === "down" : trend.direction === "up";
  const bad = trend.invert ? trend.direction === "up" : trend.direction === "down";
  const TrendIcon =
    trend.direction === "up" ? ArrowUp : trend.direction === "down" ? ArrowDown : Minus;
  const color = good ? "text-success" : bad ? "text-danger" : "text-metal-muted";
  return (
    <div className={cn("mt-2 flex items-center gap-1 text-sm font-medium", color)}>
      <TrendIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{trend.label}</span>
    </div>
  );
}

function ActionLink({ action }: { action: TruthAction }) {
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

export function BusinessTruthCard({
  title,
  value,
  meaning,
  trend,
  action,
  icon: Icon,
  className,
  ...rest
}: BusinessTruthCardProps) {
  return (
    <div
      className={cn("lm-card rounded-xl p-5 sm:p-6", className)}
      data-testid={rest["data-testid"]}
    >
      <div className="flex items-center gap-2">
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-metal-muted" aria-hidden /> : null}
        <p className="text-xs font-medium uppercase tracking-wide text-metal-muted">{title}</p>
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums text-metal-warm-white">
        {value}
      </p>
      {trend ? <TrendRow trend={trend} /> : null}
      {meaning ? (
        <p className="mt-2 text-sm leading-relaxed text-metal-muted">{meaning}</p>
      ) : null}
      {action ? <ActionLink action={action} /> : null}
    </div>
  );
}
