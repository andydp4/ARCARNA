import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLabelSettings } from "@/hooks/useLabelSettings";
import { OPS_BOARD_QUERY_KEY, type OpsBoardResponse } from "@/hooks/useOpsBoard";
import { orderDueText } from "@/lib/labels/labelRequests";
import { labelPrintErrorMessage, loadOrderForLabels, printOrderLabels } from "@/lib/labels/orderLabels";
import { deriveCardState } from "@shared/orders/opsState";
import { orderLabelKindsToPrint } from "@shared/labelSettings";
import { usePrinterState, usePrinterSupport } from "./LabelPrintPanel";

/**
 * The due time the board shows for this order, if the board has it yet (the
 * till sits beside the board, which hears about a new sale within moments).
 * The same rule the card counts down to: the promise, else the org's SLA.
 */
function boardDueText(board: OpsBoardResponse | undefined, orderId: string): string | null {
  const card = board?.orders.find((o) => o.id === orderId);
  if (!board || !card) return null;
  const now = new Date();
  const s = board.settings;
  const timing = {
    timezone: board.timezone || "Europe/London",
    prepSlaMinutes: s?.prepSlaMinutes ?? 20,
    dueSoonLeadMinutes: s?.dueSoonLeadMinutes ?? 10,
    lateGraceMinutes: s?.lateGraceMinutes ?? 5,
    deliveryLeadMinutes: s?.deliveryLeadMinutes ?? 45,
  };
  return orderDueText(deriveCardState(card, now, timing).dueEffective, now, timing.timezone);
}

/**
 * On the till, straight after a sale is taken: "Last sale #… · Print labels".
 * With "Print automatically after payment" on (Settings → Labels) and a
 * printer already connected on this till, the labels print by themselves —
 * never by opening the Bluetooth chooser unasked, which a browser only allows
 * from a tap anyway.
 */
export function TillLastSaleLabels({ orderId, onDismiss }: { orderId: string; onDismiss: () => void }) {
  const support = usePrinterSupport();
  const printer = usePrinterState();
  const settings = useLabelSettings();
  const queryClient = useQueryClient();
  const [state, setState] = useState<{ busy: boolean; message: string | null; error: boolean }>({ busy: false, message: null, error: false });
  const autoDone = useRef<string | null>(null);
  const shortCode = orderId.slice(0, 8);

  const print = async (auto: boolean) => {
    setState({ busy: true, message: auto ? "Printing labels automatically…" : null, error: false });
    try {
      const order = await loadOrderForLabels(orderId);
      const due = boardDueText(queryClient.getQueryData<OpsBoardResponse>(OPS_BOARD_QUERY_KEY), orderId);
      const n = await printOrderLabels(order, due, orderLabelKindsToPrint(settings, order.fulfilmentMethod), settings);
      setState({ busy: false, message: `Printed ${n} label${n === 1 ? "" : "s"}.`, error: false });
    } catch (e) {
      setState({ busy: false, message: labelPrintErrorMessage(e), error: true });
    }
  };

  useEffect(() => {
    if (!support.supported || !settings.autoPrintAfterPayment || printer.status !== "connected") return;
    if (autoDone.current === orderId) return;
    autoDone.current = orderId;
    // A moment for the board to hear about the sale, so the Order label carries its due time.
    const t = setTimeout(() => void print(true), 1500);
    return () => clearTimeout(t);
    // print reads the latest settings through the closure at fire time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, settings.autoPrintAfterPayment, printer.status, support.supported]);

  if (!support.supported) return null;

  return (
    <div
      className="mx-4 mt-2 flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm sm:mx-6"
      data-testid="pos-last-sale-labels"
    >
      <span className="text-muted-foreground">
        Last sale <span className="font-mono font-medium text-foreground">#{shortCode}</span>
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void print(false)}
        disabled={state.busy || printer.status === "connecting" || printer.status === "printing"}
        data-testid="pos-last-sale-print-labels"
      >
        {state.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Printer className="h-4 w-4" aria-hidden />}
        Print labels
      </Button>
      {state.message && (
        <span className={state.error ? "text-destructive" : "text-muted-foreground"} role={state.error ? "alert" : undefined}>
          {state.message}
        </span>
      )}
      <Button
        size="icon"
        variant="ghost"
        className="ml-auto h-8 w-8"
        onClick={onDismiss}
        aria-label="Hide last sale"
        data-testid="pos-last-sale-dismiss"
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
