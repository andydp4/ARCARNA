import type { LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

type QuickActionCardProps = {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  testId: string;
  className?: string;
};

export function QuickActionCard({
  href,
  icon: Icon,
  title,
  description,
  testId,
  className,
}: QuickActionCardProps) {
  return (
    <Link href={href} className={cn("group block", className)} data-testid={testId}>
      <div className="lm-quick-action lm-card rounded-lg p-4 sm:p-6 min-h-[140px] flex flex-col justify-center transition-all duration-200 group-hover:border-[hsl(210,15%,78%/0.28)] group-hover:-translate-y-0.5">
        <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-lg mb-3 sm:mb-4 bg-[hsl(215,10%,18%)] border border-[hsl(210,15%,78%/0.12)]">
          <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-metal-stainless" aria-hidden />
        </div>
        <h3 className="text-base sm:text-lg font-semibold text-metal-warm-white mb-1 sm:mb-2">{title}</h3>
        <p className="text-xs sm:text-sm text-metal-muted">{description}</p>
      </div>
    </Link>
  );
}
