import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type EmptyStateVariant = "empty" | "filtered" | "search";

const variantStyles: Record<EmptyStateVariant, string> = {
  /** No data at all (e.g. zero orders in system) */
  empty: "border-dashed border-border/80 bg-muted/20",
  /** Filters exclude everything */
  filtered: "border border-border/70 bg-muted/15",
  /** Search / text query returned nothing */
  search: "border border-primary/15 bg-primary/[0.04]",
};

type EmptyStatePanelProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  variant?: EmptyStateVariant;
  className?: string;
};

export function EmptyStatePanel({ icon: Icon, title, description, variant = "empty", className }: EmptyStatePanelProps) {
  return (
    <div
      className={cn(
        "mx-auto max-w-md rounded-xl px-6 py-10 text-center",
        variantStyles[variant],
        className
      )}
      role="status"
    >
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-background/70 ring-1 ring-border/60">
        <Icon className="h-8 w-8 text-muted-foreground/75" aria-hidden />
      </div>
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
