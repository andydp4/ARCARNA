import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Card surfaces inside Layout (`.liquid-metal`). */
export const LM_CARD = "lm-card border-0 shadow-none";

export type PageHeaderProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  className?: string;
};

export function PageHeader({ title, description, icon: Icon, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-6", className)}>
      <h1 className="text-2xl sm:text-3xl font-semibold text-metal-warm-white flex items-center gap-2">
        {Icon ? <Icon className="h-6 sm:h-8 w-6 sm:w-8 shrink-0 text-[hsl(210,10%,78%)]" aria-hidden /> : null}
        {title}
      </h1>
      {description ? (
        <p className="text-metal-muted mt-1 max-w-3xl text-sm sm:text-base leading-relaxed">{description}</p>
      ) : null}
    </div>
  );
}
