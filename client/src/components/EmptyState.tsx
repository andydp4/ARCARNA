import type { LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type EmptyStateCta = {
  label: string;
  href?: string;
  onClick?: () => void;
};

export type EmptyStateProps = {
  title: string;
  body: string;
  cta?: EmptyStateCta;
  secondary?: EmptyStateCta;
  icon?: LucideIcon;
  className?: string;
};

function CtaButton({ cta, variant }: { cta: EmptyStateCta; variant: "default" | "outline" }) {
  const className = "min-h-[44px]";
  if (cta.href) {
    return (
      <Button asChild variant={variant} className={className}>
        <Link href={cta.href}>{cta.label}</Link>
      </Button>
    );
  }
  return (
    <Button type="button" variant={variant} className={className} onClick={cta.onClick}>
      {cta.label}
    </Button>
  );
}

/**
 * Designed empty state for list pages: icon, title, body, primary CTA, optional secondary action.
 */
export function EmptyState({ title, body, cta, secondary, icon: Icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "mx-auto max-w-md rounded-xl border border-dashed border-border/80 bg-muted/20 px-6 py-10 text-center",
        className
      )}
      role="status"
    >
      {Icon && (
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-background/70 ring-1 ring-border/60">
          <Icon className="h-8 w-8 text-muted-foreground/75" aria-hidden />
        </div>
      )}
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      {(cta || secondary) && (
        <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          {cta && <CtaButton cta={cta} variant="default" />}
          {secondary && <CtaButton cta={secondary} variant="outline" />}
        </div>
      )}
    </div>
  );
}
