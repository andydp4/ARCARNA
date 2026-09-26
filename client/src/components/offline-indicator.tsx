import { useEffect, useState } from "react";
import { resolveAppPath } from "@/lib/appPaths";
import { WifiOff, CloudOff, Cloud, CloudUpload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { useSaleQueueStatus } from "@/hooks/useSaleQueueStatus";
import { formatSaleQueueStatus } from "@shared/orders/saleReference";
import { isAtLeast } from "@shared/accessPolicy";

/**
 * Connection state, and what the till is holding (v1.2 Phase 1A): "2 waiting
 * · 1 failed". Waiting sales are on this till and will be sent; failed ones
 * were refused and are on Needs attention for a manager. The pill stays up for
 * as long as either is non-zero, online or not — a sale that has not reached
 * arcarna is worth knowing about whatever the Wi-Fi icon says.
 */
export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showAlert, setShowAlert] = useState(!navigator.onLine);
  const { user } = useAuth();
  const queue = useSaleQueueStatus();
  const status = formatSaleQueueStatus(queue.waiting, queue.failed);
  const isManager = isAtLeast(user?.role, "MANAGER");

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowAlert(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const pill = (!isOnline || status) && (
    <div
      className="bg-popover text-popover-foreground px-3 py-2 rounded-full shadow-lg flex items-center gap-2"
      data-testid="offline-indicator-pill"
      title={
        queue.failed > 0
          ? "Failed sales were refused by arcarna. A manager deals with them on Needs attention."
          : queue.waiting > 0
            ? "Waiting sales are saved on this till and will be sent automatically."
            : undefined
      }
    >
      {isOnline ? <CloudUpload className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      <span className="text-sm font-medium" data-testid="offline-indicator-status">
        {!isOnline ? (status ? `Offline · ${status}` : "Offline") : status}
      </span>
      {queue.failed > 0 && isManager && (
        // A plain link: this sits outside the app's router, so it carries the
        // base path itself.
        <a href={resolveAppPath("/needs-attention")} className="text-sm underline" data-testid="offline-indicator-needs-attention">
          Review
        </a>
      )}
    </div>
  );

  if (!showAlert) {
    return (
      <div className="fixed bottom-4 right-4 z-50" data-testid="offline-indicator-icon">
        {pill}
      </div>
    );
  }

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4" data-testid="offline-indicator-alert">
      {/* Semantic tokens, not light-mode Tailwind steps: bg-green-50 on the
          always-dark Liquid Metal shell rendered as a near-white slab. */}
      <Alert
        className="border backdrop-blur"
        style={{
          // These tokens are complete colour values (e.g. `hsl(158 64% 45%)`),
          // so they are used bare — wrapping them in hsl() would be invalid.
          backgroundColor: isOnline
            ? "color-mix(in srgb, var(--success) 14%, var(--card))"
            : "color-mix(in srgb, var(--warning) 14%, var(--card))",
          borderColor: isOnline
            ? "color-mix(in srgb, var(--success) 45%, transparent)"
            : "color-mix(in srgb, var(--warning) 45%, transparent)",
        }}
      >
        <div className="flex items-center gap-2">
          {isOnline ? (
            <>
              <Cloud className="h-5 w-5" style={{ color: "hsl(var(--success))" }} />
              <AlertDescription className="font-medium text-foreground">
                {queue.waiting > 0
                  ? `Back online. Sending ${queue.waiting} saved sale${queue.waiting === 1 ? "" : "s"}.`
                  : "Back online."}
              </AlertDescription>
            </>
          ) : (
            <>
              <CloudOff className="h-5 w-5" style={{ color: "hsl(var(--warning))" }} />
              <AlertDescription className="font-medium text-foreground">
                No connection. Sales are saved on this till and sent when the connection is back — each one is recorded once.
              </AlertDescription>
            </>
          )}
        </div>
      </Alert>
    </div>
  );
}
