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
import { whatsNewAccountKey } from "@shared/uiSeen";
import { useSeenOnce } from "@/hooks/useSeenOnce";

/** The per-device flag this used before seen-state moved to the account; still honoured. */
function legacySeenKey(version: string) {
  return `whatsNew:seen:${version}`;
}

/**
 * A dismissible "What's New" summary shown once per ACCOUNT after a new
 * version ships, filtered to the bullets relevant to the viewer's own role.
 *
 * It used to be gated by a localStorage flag alone, which is per browser — so
 * it came back on every other device, in the installed app, and after site
 * data was cleared ("every time you log in or switch device"). useSeenOnce
 * records it against the account (user_ui_seen, migration 069).
 */
export function WhatsNewModal() {
  const { isAuthenticated, user } = useAuth();
  const [open, setOpen] = useState(false);
  const { seen, markSeen } = useSeenOnce(
    whatsNewAccountKey(LATEST_WHATS_NEW_VERSION),
    legacySeenKey(LATEST_WHATS_NEW_VERSION),
  );

  useEffect(() => {
    if (!isAuthenticated || !user || user.role === "CUSTOMER") return;
    if (seen === false) setOpen(true);
  }, [isAuthenticated, user, seen]);

  if (!isAuthenticated || !user || user.role === "CUSTOMER") return null;

  const items = whatsNewForRole(LATEST_WHATS_NEW_VERSION, user.role);
  if (items.length === 0) return null;

  const dismiss = () => {
    markSeen();
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
                  <p className="font-medium text-foreground">{item.title}</p>
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
