import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type AppPageHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  className?: string;
};

/**
 * Shared rhythm for in-app pages: eyebrow → title → description, optional actions / meta on the right.
 */
export function AppPageHeader({
  title,
  description,
  eyebrow,
  icon,
  trailing,
  className,
}: AppPageHeaderProps) {
  return (
    <div
      className={cn(
        "mb-8 flex flex-col gap-3 border-b border-border/60 pb-6 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? (
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</p>
        ) : null}
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {icon}
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {trailing ? <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">{trailing}</div> : null}
    </div>
  );
}
