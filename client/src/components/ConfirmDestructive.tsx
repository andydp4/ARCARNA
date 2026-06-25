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
};

/**
 * Destructive confirmation, built on the standard dialog layout
 * (Question · Explanation · Primary · Secondary). The consequence is spelled
 * out in `description`; the user must type `confirmText` to enable the action.
 */
export function ConfirmDestructive({
  open,
  title,
  description,
  confirmText = "DELETE",
  onConfirm,
  onCancel,
  busy,
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
        label: "Confirm",
        disabled: typed !== confirmText,
        onClick: () => {
          onConfirm();
          setTyped("");
        },
      }}
    >
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
    </StandardDialog>
  );
}
