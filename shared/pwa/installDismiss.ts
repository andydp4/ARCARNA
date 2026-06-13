export const PWA_INSTALL_DISMISS_KEY = "arcarna-pwa-install-dismissed-until";
export const PWA_INSTALL_DISMISS_KEY_LEGACY = "midnight-pwa-install-dismissed-until";

function migrateDismissKey(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(PWA_INSTALL_DISMISS_KEY) !== null) return;
  const legacy = localStorage.getItem(PWA_INSTALL_DISMISS_KEY_LEGACY);
  if (legacy !== null) {
    localStorage.setItem(PWA_INSTALL_DISMISS_KEY, legacy);
    localStorage.removeItem(PWA_INSTALL_DISMISS_KEY_LEGACY);
  }
}

export function dismissPwaInstall(days = 7): void {
  try {
    localStorage.setItem(PWA_INSTALL_DISMISS_KEY, String(Date.now() + days * 24 * 60 * 60 * 1000));
  } catch {
    /* ignore */
  }
}

export function isPwaInstallDismissed(): boolean {
  try {
    migrateDismissKey();
    const until = localStorage.getItem(PWA_INSTALL_DISMISS_KEY);
    if (!until) return false;
    return Date.now() < parseInt(until, 10);
  } catch {
    return false;
  }
}
