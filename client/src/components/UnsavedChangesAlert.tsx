import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface UnsavedChangesAlertProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStay: () => void;
  onLeave: () => void;
  title?: string;
  description?: string;
  stayLabel?: string;
  leaveLabel?: string;
}

export function UnsavedChangesAlert({
  open,
  onOpenChange,
  onStay,
  onLeave,
  title = "Leave without finishing?",
  description = "You have unsaved progress. If you leave now, your changes will be lost.",
  stayLabel = "Stay",
  leaveLabel = "Leave",
}: UnsavedChangesAlertProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="z-[60]">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-[44px]" onClick={onStay}>
            {stayLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            className="min-h-[44px]"
            onClick={(e) => {
              e.preventDefault();
              onLeave();
            }}
          >
            {leaveLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
