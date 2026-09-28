import { useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLabelSettings } from "@/hooks/useLabelSettings";
import { orderLabelKindsToPrint } from "@shared/labelSettings";
import { labelPrintErrorMessage, loadOrderForLabels, printOrderLabels } from "@/lib/labels/orderLabels";
import { usePrinterState, usePrinterSupport } from "./LabelPrintPanel";

/**
 * One tap: print this order's labels — the set chosen in Settings → Labels —
 * without opening its details. Used on board cards (live and in the Done
 * tray) and on the till after payment. Hidden where the browser cannot reach
 * a Bluetooth printer at all (iPhone/iPad, Safari); the details sheet says why.
 */
export function QuickPrintLabelsButton({
  orderId,
  shortCode,
  dueText,
  size = "touch",
  variant = "outline",
  showText = true,
  className,
  testId,
}: {
  orderId: string;
  shortCode: string;
  dueText: string | null;
  size?: "touch" | "sm" | "default";
  variant?: "outline" | "default" | "secondary";
  showText?: boolean;
  className?: string;
  testId?: string;
}) {
  const support = usePrinterSupport();
  const printer = usePrinterState();
  const settings = useLabelSettings();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  if (!support.supported) return null;

  const onClick = async () => {
    setBusy(true);
    try {
      const order = await loadOrderForLabels(orderId);
      const n = await printOrderLabels(order, dueText, orderLabelKindsToPrint(settings, order.fulfilmentMethod), settings);
      toast({ title: `Printed ${n} label${n === 1 ? "" : "s"}`, description: `Order #${shortCode}` });
    } catch (e) {
      toast({
        title: "Couldn't print the labels",
        description: labelPrintErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const printerBusy = printer.status === "connecting" || printer.status === "printing";
  return (
    <Button
      size={size}
      variant={variant}
      onClick={onClick}
      disabled={busy || printerBusy}
      aria-label={`Print labels for order ${shortCode}`}
      className={className}
      data-testid={testId ?? `button-quick-print-labels-${orderId}`}
    >
      {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : <Printer className="h-4 w-4 shrink-0" aria-hidden />}
      {showText && <span className="hidden sm:inline">Labels</span>}
    </Button>
  );
}
