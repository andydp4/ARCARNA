export const PWA_INSTALL_DISMISS_KEY = "midnight-pwa-install-dismissed-until";

export function dismissPwaInstall(days = 7): void {
  try {
    localStorage.setItem(PWA_INSTALL_DISMISS_KEY, String(Date.now() + days * 24 * 60 * 60 * 1000));
  } catch {
    /* ignore */
  }
}

export function isPwaInstallDismissed(): boolean {
  try {
    const until = localStorage.getItem(PWA_INSTALL_DISMISS_KEY);
    if (!until) return false;
    return Date.now() < parseInt(until, 10);
  } catch {
    return false;
  }
}
