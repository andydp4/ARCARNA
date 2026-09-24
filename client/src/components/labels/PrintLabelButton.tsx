import { useState } from "react";
import { Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LabelPrintPanel, type LabelRequest } from "./LabelPrintPanel";

/**
 * "Print label" for a product row: opens a small dialog with the preview and
 * Print. `compact` is the icon-only form for the desktop table's action cell.
 */
export function PrintLabelButton({
  request,
  title,
  compact = false,
  className,
  testId,
}: {
  request: LabelRequest;
  /** Dialog heading, e.g. the product name. */
  title: string;
  compact?: boolean;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon" : "sm"}
        onClick={() => setOpen(true)}
        className={className}
        aria-label={`Print label for ${title}`}
        data-testid={testId}
      >
        <Tag className={compact ? "h-4 w-4" : "h-4 w-4 sm:mr-2"} aria-hidden />
        {!compact && <span className="hidden sm:inline">Label</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Print label</DialogTitle>
            <DialogDescription>{title} · 50 × 30 mm</DialogDescription>
          </DialogHeader>
          {open && <LabelPrintPanel request={request} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * "Print label" for an order on the Ops board: expands in place rather than
 * opening a dialog, because on a phone the details panel shares the screen
 * with the order form and the till never mounts a dialog over it.
 */
export function InlinePrintLabel({ request, testId }: { request: LabelRequest; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <Button
        size="touch"
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid={testId}
      >
        <Tag className="h-4 w-4" aria-hidden />
        {open ? "Hide label" : "Print label"}
      </Button>
      {open && <LabelPrintPanel request={request} />}
    </div>
  );
}
