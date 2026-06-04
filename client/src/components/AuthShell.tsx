import type { ReactNode } from "react";
import { BrandLogo } from "@/components/BrandLogo";

type AuthShellProps = {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  showBrand?: boolean;
};

/** Liquid Metal chrome for unauthenticated entry pages (landing, sign-in). */
export function AuthShell({
  children,
  title = "Midnight EPOS",
  subtitle = "Enterprise Point of Sale System",
  showBrand = true,
}: AuthShellProps) {
  return (
    <div className="lm-auth-shell liquid-metal min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        {showBrand && (
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center mb-4 rounded-2xl lm-card p-3 ring-1 ring-[hsl(210,15%,78%/0.12)]">
              <BrandLogo variant="white-on-navy" size="xl" className="rounded-xl" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-metal-warm-white mb-2">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-metal-muted text-base sm:text-lg">{subtitle}</p>
            ) : null}
          </div>
        )}

        <div className="lm-card rounded-xl p-6 sm:p-8 shadow-metal-panel">{children}</div>

        <p className="text-center mt-8 text-metal-muted text-sm">
          © {new Date().getFullYear()} Midnight EPOS
        </p>
      </div>
    </div>
  );
}
