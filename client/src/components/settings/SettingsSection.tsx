import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Settings Section (Component Spec — Phase 4).
 * Consistent layout for a settings group: what it is, why it matters, and the
 * controls to change it. Surface: refined Liquid Metal (`lm-card`).
 */
export type SettingsSectionProps = {
  /** What is this group of settings? */
  title: string;
  /** Why does it matter / what does it change? One short sentence. */
  description?: string;
  /** Optional right-aligned action (e.g. Save). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <section className={cn("lm-card rounded-xl p-5 sm:p-6", className)}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-metal-warm-white">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-metal-muted">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
