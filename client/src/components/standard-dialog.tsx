import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Standard Dialog (Component Spec — Phase 4).
 *
 * One coherent dialog layout:
 *   Question     → the decision (title)
 *   Explanation  → what happens / the consequence (description)
 *   [children]   → optional fields
 *   Primary      → the confirming action
 *   Secondary    → cancel / alternate (defaults to "Cancel")
 *
 * Destructive dialogs set `destructive` to colour the primary action and must
 * spell out the consequence in `explanation`.
 */

export type StandardDialogAction = {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
};

export type StandardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Question — the decision being made. */
  question: string;
  /** Explanation — what happens next / the consequence. */
  explanation?: ReactNode;
  /** Optional content (forms, inputs) between explanation and the actions. */
  children?: ReactNode;
  /** Primary (confirming) action. */
  primaryAction: StandardDialogAction;
  /** Secondary action. Defaults to a "Cancel" that closes the dialog. */
  secondaryAction?: StandardDialogAction;
  /** Destructive: danger-styled primary; consequence must be explained. */
  destructive?: boolean;
  /** Disables actions while an operation is in flight. */
  busy?: boolean;
  className?: string;
};

export function StandardDialog({
  open,
  onOpenChange,
  question,
  explanation,
  children,
  primaryAction,
  secondaryAction,
  destructive,
  busy,
  className,
}: StandardDialogProps) {
  const handleSecondary = () => {
    if (secondaryAction?.onClick) secondaryAction.onClick();
    else onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className}>
        <DialogHeader>
          <DialogTitle>{question}</DialogTitle>
          {explanation ? <DialogDescription>{explanation}</DialogDescription> : null}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button
            variant="outline"
            className="lm-btn-outline"
            onClick={handleSecondary}
            disabled={busy || secondaryAction?.disabled}
          >
            {secondaryAction?.label ?? "Cancel"}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            className={destructive ? undefined : "lm-btn-metal"}
            onClick={primaryAction.onClick}
            disabled={busy || primaryAction.disabled}
          >
            {primaryAction.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
