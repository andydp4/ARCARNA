import { useCallback, useEffect, useState } from "react";
import { dismissPwaInstall, isPwaInstallDismissed } from "@shared/pwa/installDismiss";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
}

export function usePwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(isPwaInstallDismissed);
  const [standalone] = useState(isStandaloneDisplay);
  const [ios] = useState(isIosSafari);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  const dismiss = useCallback(() => {
    dismissPwaInstall(7);
    setDismissed(true);
    setDeferred(null);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === "accepted") dismissPwaInstall(30);
    return outcome === "accepted";
  }, [deferred]);

  const showIosHint = ios && !standalone && !dismissed;
  const showInstallPrompt = !!deferred && !standalone && !dismissed;
  const visible = showInstallPrompt || showIosHint;

  return {
    visible,
    showInstallPrompt,
    showIosHint,
    isStandalone: standalone,
    promptInstall,
    dismiss,
  };
}
