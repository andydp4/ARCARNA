import { useEffect, useSyncExternalStore } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { isAtLeast } from "@shared/accessPolicy";
import { localIsoDate } from "@shared/orders/orderDate";
import { studyActiveOn, studyBannerText, type StudyWindow } from "@shared/usage";
import { getPreviewRole } from "@/lib/previewRole";
import { countOfflineSpellOnStart, usageRecorder } from "@/lib/usage";

/** How often the clock is brought up to date, and how often a batch is sent. */
const TICK_MS = 5_000;
const FLUSH_MS = 60_000;

/**
 * Our own usage record (v1.2 Phase 8B), mounted once inside the signed-in
 * app. It follows the route, counts input and visibility for active time, and
 * sends batches. Nothing on screen: the staff privacy notice
 * (docs/staff-privacy-notice.md) is how staff are told.
 */
export function UsageRecorder() {
  const [location] = useLocation();
  const search = useSearch();
  const { user } = useAuth();
  const enabled = isAtLeast(user?.role, "CASHIER") && !getPreviewRole();

  useEffect(() => {
    usageRecorder.setEnabled(enabled);
    if (enabled) countOfflineSpellOnStart();
  }, [enabled]);

  useEffect(() => {
    usageRecorder.setPath(location, search);
  }, [location, search]);

  useEffect(() => {
    // Only that input happened, never what it was.
    const onInput = () => usageRecorder.input();
    const onVisibility = () => {
      const visible = document.visibilityState === "visible";
      usageRecorder.setVisible(visible);
      if (!visible) {
        usageRecorder.endView();
        void usageRecorder.flush({ keepalive: true });
      }
    };
    const onPageHide = () => {
      usageRecorder.endView();
      void usageRecorder.flush({ keepalive: true });
    };
    const opts = { capture: true, passive: true } as const;
    const inputs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of inputs) window.addEventListener(e, onInput, opts);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    usageRecorder.setVisible(document.visibilityState === "visible");
    const tick = window.setInterval(() => usageRecorder.tick(), TICK_MS);
    const flush = window.setInterval(() => void usageRecorder.flush(), FLUSH_MS);
    const onOnline = () => void usageRecorder.flush();
    window.addEventListener("online", onOnline);
    return () => {
      for (const e of inputs) window.removeEventListener(e, onInput, opts);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      window.clearInterval(tick);
      window.clearInterval(flush);
    };
  }, []);

  return null;
}

/**
 * "Improvement study on this screen until <date>" (v1.2 Phase 8, on demand).
 * Shown only while the owner's study window is on, on the screens it names.
 * No outside recorder is connected: this is the announcement, ready for when
 * one is (after an adviser review).
 */
export function StudyBanner() {
  const { user } = useAuth();
  const isStaff = isAtLeast(user?.role, "CASHIER");
  // The recorder's idea of the screen: it knows which Operations Centre pane is in front.
  const screen = useSyncExternalStore(
    (cb) => usageRecorder.subscribe(cb),
    () => usageRecorder.currentScreen(),
  );
  const { data } = useQuery<StudyWindow & { active: boolean }>({
    queryKey: ["/api/usage/study-window"],
    enabled: isStaff,
    staleTime: 10 * 60_000,
    refetchInterval: 30 * 60_000,
  });
  if (!data?.active || !data.endsOn || !studyActiveOn(data, screen, localIsoDate())) return null;
  const until = new Date(`${data.endsOn}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-border bg-muted px-4 py-1.5 text-sm text-muted-foreground"
      data-testid="study-banner"
    >
      <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
      <span>{studyBannerText(until)}</span>
    </div>
  );
}
