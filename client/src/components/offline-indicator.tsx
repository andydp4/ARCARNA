import { useEffect, useState } from "react";
import { Wifi, WifiOff, CloudOff, Cloud } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showAlert, setShowAlert] = useState(!navigator.onLine);

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

  if (!showAlert) {
    return (
      <div className="fixed bottom-4 right-4 z-50" data-testid="offline-indicator-icon">
        {!isOnline && (
          <div className="bg-slate-800 text-white px-3 py-2 rounded-full shadow-lg flex items-center gap-2">
            <WifiOff className="h-4 w-4" />
            <span className="text-sm font-medium">Offline</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4" data-testid="offline-indicator-alert">
      <Alert className={isOnline ? "bg-green-50 border-green-200" : "bg-orange-50 border-orange-200"}>
        <div className="flex items-center gap-2">
          {isOnline ? (
            <>
              <Cloud className="h-5 w-5 text-green-600" />
              <AlertDescription className="text-green-800 font-medium">
                Back online! Data will sync automatically.
              </AlertDescription>
            </>
          ) : (
            <>
              <CloudOff className="h-5 w-5 text-orange-600" />
              <AlertDescription className="text-orange-800 font-medium">
                You're offline. Orders will be saved and synced when connection returns.
              </AlertDescription>
            </>
          )}
        </div>
      </Alert>
    </div>
  );
}
