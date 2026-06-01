import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { resolveAppPath } from "@/lib/appPaths";

type HullPanelProps = {
  children: ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  headerSlot?: ReactNode;
  showLogo?: boolean;
};

export function HullPanel({
  children,
  className,
  title,
  subtitle,
  headerSlot,
  showLogo = true,
}: HullPanelProps) {
  const hasHeader = showLogo || title || subtitle || headerSlot;

  return (
    <section
      className={cn(
        "hull-panel relative overflow-hidden rounded-lg",
        "transition-shadow duration-300 ease-out",
        className,
      )}
    >
      {hasHeader && (
        <header className="flex flex-col gap-3 border-b border-metal-edge/30 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            {showLogo && (
              <img
                src={resolveAppPath("/brand/midnight-logo-white-on-navy.png")}
                alt="Midnight"
                className="h-9 w-auto shrink-0 object-contain sm:h-10"
                width={120}
                height={40}
                decoding="async"
              />
            )}
            {(title || subtitle) && (
              <div className="min-w-0">
                {title && (
                  <h1 className="truncate text-lg font-semibold tracking-tight text-metal-warm-white sm:text-xl">
                    {title}
                  </h1>
                )}
                {subtitle && (
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-metal-muted sm:text-sm sm:line-clamp-1">
                    {subtitle}
                  </p>
                )}
              </div>
            )}
          </div>
          {headerSlot && <div className="flex shrink-0 items-center gap-2">{headerSlot}</div>}
        </header>
      )}

      <div className="relative px-4 py-6 sm:px-6 sm:py-8">{children}</div>
    </section>
  );
}
