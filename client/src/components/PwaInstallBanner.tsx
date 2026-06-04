import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/hooks/usePwaInstall";

export function PwaInstallBanner() {
  const { visible, showInstallPrompt, showIosHint, promptInstall, dismiss } = usePwaInstall();

  if (!visible) return null;

  return (
    <div
      className="lm-shell-header border-b border-primary/20 bg-primary/5 px-4 py-2"
      role="region"
      aria-label="Install Midnight EPOS"
      data-testid="pwa-install-banner"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2 text-sm">
          <Download className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p className="text-foreground">
            {showIosHint && !showInstallPrompt ? (
              <>
                Install on this device: tap <Share className="inline h-3.5 w-3.5" aria-hidden /> Share,
                then <strong>Add to Home Screen</strong> for offline POS access.
              </>
            ) : (
              <>
                Install <strong>Midnight EPOS</strong> for fullscreen POS, faster launch, and offline shell.
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {showInstallPrompt && (
            <Button size="sm" onClick={() => void promptInstall()} data-testid="pwa-install-cta">
              Install app
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={dismiss}
            aria-label="Dismiss install prompt for 7 days"
            data-testid="pwa-install-dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
