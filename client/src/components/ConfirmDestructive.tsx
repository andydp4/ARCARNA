import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StandardDialog } from "@/components/standard-dialog";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  /**
   * Type-to-confirm. Right for bulk deletes, needless friction for a single
   * record — set false there and the primary action reads as the verb instead.
   */
  requireTyping?: boolean;
  /** Primary button label. Use a specific verb ("Delete customer"), not "Confirm". */
  confirmLabel?: string;
};

/**
 * Destructive confirmation, built on the standard dialog layout
 * (Question · Explanation · Primary · Secondary). The consequence is spelled
 * out in `description`; for bulk actions the user must also type `confirmText`.
 */
export function ConfirmDestructive({
  open,
  title,
  description,
  confirmText = "DELETE",
  onConfirm,
  onCancel,
  busy,
  requireTyping = true,
  confirmLabel,
}: Props) {
  const [typed, setTyped] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setTyped("");
      onCancel();
    }
  };

  return (
    <StandardDialog
      open={open}
      onOpenChange={handleOpenChange}
      destructive
      busy={busy}
      question={title}
      explanation={description}
      secondaryAction={{ label: "Cancel", onClick: onCancel }}
      primaryAction={{
        label: confirmLabel ?? (requireTyping ? "Confirm" : "Delete"),
        disabled: requireTyping && typed !== confirmText,
        onClick: () => {
          onConfirm();
          setTyped("");
        },
      }}
    >
      {requireTyping && (
        <div className="space-y-2">
          <Label htmlFor="confirm-destructive">
            Type <span className="font-mono font-semibold">{confirmText}</span> to confirm
          </Label>
          <Input
            id="confirm-destructive"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        </div>
      )}
    </StandardDialog>
  );
}
