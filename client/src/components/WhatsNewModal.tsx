import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LATEST_WHATS_NEW_VERSION, whatsNewForRole } from "@shared/whatsNew";

function seenKey(version: string) {
  return `whatsNew:seen:${version}`;
}

/** localStorage only — read/write can legitimately throw (private mode,
 *  cleared/blocked site data) and this feature is a courtesy, not something
 *  that should ever break the app if storage is unavailable. */
function hasSeen(version: string): boolean {
  try {
    return localStorage.getItem(seenKey(version)) === "1";
  } catch {
    return true;
  }
}

function markSeen(version: string) {
  try {
    localStorage.setItem(seenKey(version), "1");
  } catch {
    // Nothing to do — worst case the modal shows again next login.
  }
}

/**
 * A dismissible "What's New" summary shown once per browser after a new
 * version ships, filtered to the bullets relevant to the viewer's own role.
 * Gated by a version-keyed localStorage flag rather than a server-side
 * per-user column — this is a lightweight release courtesy, not durable
 * state that needs to sync across devices.
 */
export function WhatsNewModal() {
  const { isAuthenticated, user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !user || user.role === "CUSTOMER") return;
    if (!hasSeen(LATEST_WHATS_NEW_VERSION)) {
      setOpen(true);
    }
  }, [isAuthenticated, user]);

  if (!isAuthenticated || !user || user.role === "CUSTOMER") return null;

  const items = whatsNewForRole(LATEST_WHATS_NEW_VERSION, user.role);
  if (items.length === 0) return null;

  const dismiss = () => {
    markSeen(LATEST_WHATS_NEW_VERSION);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>What's new in v{LATEST_WHATS_NEW_VERSION}</DialogTitle>
          <DialogDescription>
            A quick summary of what changed for your role.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-4">
            {items.map((item, i) => (
              <div key={`${item.area}-${i}`} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {item.area}
                  </Badge>
                  <p className="font-medium">{item.title}</p>
                </div>
                <p className="text-sm text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button onClick={dismiss} data-testid="whats-new-dismiss">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
