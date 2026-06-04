import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type EmptyStatePanelProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  variant?: "empty" | "filtered" | "search";
  className?: string;
};

export function EmptyStatePanel({ icon: Icon, title, description, variant = "empty", className }: EmptyStatePanelProps) {
  return (
    <div
      className={cn(
        "mx-auto max-w-md rounded-xl px-6 py-10 text-center lm-card-muted border-dashed",
        variant === "filtered" && "border-solid",
        variant === "search" && "border-solid ring-1 ring-[hsl(210,15%,78%/0.08)]",
        className
      )}
      role="status"
    >
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(215,10%,18%)] ring-1 ring-[hsl(210,15%,78%/0.12)]">
        <Icon className="h-8 w-8 text-metal-muted" aria-hidden />
      </div>
      <p className="text-base font-semibold text-metal-warm-white">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-metal-muted">{description}</p>
    </div>
  );
}
