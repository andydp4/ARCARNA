import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Card surfaces inside Layout (`.liquid-metal`). */
export const LM_CARD = "lm-card border-0 shadow-none";

/**
 * Arcarna Page Header (Design System v1.0 — Phase 2).
 * Approved structure: Title · Business Question · Short explanation · optional Primary Action.
 * `question` is sourced from the Route Experience Specification.
 */
export type PageHeaderProps = {
  /** Page title (h1). Current product name — renames are Phase 3. */
  title: string;
  /** The business question this route answers (Route Experience Spec). */
  question?: string;
  /** One short sentence: what this page shows / what to do next. */
  explanation?: string;
  /** @deprecated Use `explanation`. Back-compat alias, rendered as the explanation. */
  description?: string;
  /** Optional eyebrow (e.g. nav group or step indicator). */
  eyebrow?: string;
  /** Optional leading icon. */
  icon?: LucideIcon;
  /** Optional primary action(s), right-aligned. */
  action?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  question,
  explanation,
  description,
  eyebrow,
  icon: Icon,
  action,
  className,
}: PageHeaderProps) {
  const explain = explanation ?? description;
  return (
    <div
      className={cn(
        "mb-6",
        action && "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-metal-muted">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-metal-warm-white sm:text-3xl">
          {Icon ? (
            <Icon className="h-6 w-6 shrink-0 text-metal-stainless sm:h-7 sm:w-7" aria-hidden />
          ) : null}
          {title}
        </h1>
        {question ? (
          <p className="mt-1.5 text-base text-metal-warm-white">{question}</p>
        ) : null}
        {explain ? (
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-metal-muted">{explain}</p>
        ) : null}
      </div>
      {action ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{action}</div>
      ) : null}
    </div>
  );
}
