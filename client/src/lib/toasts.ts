import { toast } from "@/hooks/use-toast";

/**
 * Standardised toast helpers (Component Spec — Phase 4).
 *
 * Toasts confirm an outcome, calmly. Success/info use the default (neutral)
 * surface — never celebratory, never alarmist. Errors use the destructive
 * surface and say what to do next.
 *
 * Title = what happened. Description = the detail or the next step.
 */
export function notifySuccess(title: string, description?: string) {
  return toast({ title, description });
}

export function notifyInfo(title: string, description?: string) {
  return toast({ title, description });
}

export function notifyError(title: string, description?: string) {
  return toast({ title, description, variant: "destructive" });
}
