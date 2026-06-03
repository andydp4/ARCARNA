import { useEffect } from "react";

export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  const tag = el.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function shouldOpenCommandPalette(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">,
  target: unknown,
): boolean {
  if (event.key.toLowerCase() !== "k") return false;
  if (!event.metaKey && !event.ctrlKey) return false;
  if (isEditableTarget(target)) return false;
  return true;
}

type UseGlobalShortcutOptions = {
  enabled?: boolean;
  onTrigger: () => void;
};

export function useGlobalShortcut({ enabled = true, onTrigger }: UseGlobalShortcutOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (event: KeyboardEvent) => {
      if (!shouldOpenCommandPalette(event, event.target)) return;
      event.preventDefault();
      onTrigger();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, onTrigger]);
}
