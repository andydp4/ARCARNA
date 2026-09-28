import { useMemo, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLabelSettings } from "@/hooks/useLabelSettings";
import { ORDER_LABEL_KINDS, ORDER_LABEL_TITLES, orderLabelKindsToPrint, type OrderLabelKind } from "@shared/labelSettings";
import { labelPrintErrorMessage, printOrderLabels, type OrderLabelsOrder } from "@/lib/labels/orderLabels";
import { PrinterStatusLine, PrinterSupportNotice, usePrinterState, usePrinterSupport } from "./LabelPrintPanel";

export type { OrderLabelsOrder } from "@/lib/labels/orderLabels";

/**
 * Niimbot labels for one order (owner brief: several label types per order,
 * "option to reprint them all or just one type"). "Print labels" prints the
 * set the shop chose in Settings → Labels; every type can still be printed on
 * its own. The layouts follow the same settings.
 */
export function OrderLabelPrintPanel({ order, dueText }: { order: OrderLabelsOrder; dueText: string | null }) {
  const support = usePrinterSupport();
  const printer = usePrinterState();
  const settings = useLabelSettings();
  const [busy, setBusy] = useState<OrderLabelKind | "set" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const jobs = useMemo(
    () =>
      ORDER_LABEL_KINDS.filter((k) => k !== "deliveryNote" || order.fulfilmentMethod === "delivery").map((key) => ({
        key,
        title: key === "picking" && order.items.length ? `Picking list (${order.items.length})` : ORDER_LABEL_TITLES[key],
      })),
    [order.items.length, order.fulfilmentMethod],
  );
  const set = orderLabelKindsToPrint(settings, order.fulfilmentMethod);

  const run = async (key: OrderLabelKind | "set", kinds: OrderLabelKind[], done: (n: number) => string) => {
    setError(null);
    setNotice(null);
    setBusy(key);
    try {
      const n = await printOrderLabels(order, dueText, kinds, settings);
      setNotice(done(n));
    } catch (e) {
      setError(labelPrintErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!support.supported) return <PrinterSupportNotice message={support.message} />;

  const anyBusy = busy !== null || printer.status === "connecting" || printer.status === "printing";

  return (
    <div className="space-y-3" data-testid="order-labels-panel">
      <PrinterStatusLine />
      <div className="flex flex-wrap gap-2">
        <Button
          size="touch"
          onClick={() => run("set", set, (n) => `Printed ${n} label${n === 1 ? "" : "s"}.`)}
          disabled={anyBusy}
          data-testid="button-print-all-labels"
        >
          {busy === "set" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Printer className="h-4 w-4" aria-hidden />}
          Print labels ({set.length})
        </Button>
        {jobs.map((job) => (
          <Button
            key={job.key}
            size="touch"
            variant="outline"
            onClick={() => run(job.key, [job.key], () => `Printed ${job.title}.`)}
            disabled={anyBusy}
            data-testid={`button-print-label-${job.key}`}
          >
            {busy === job.key && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {job.title}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="order-labels-error">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="text-sm text-muted-foreground" data-testid="order-labels-notice">
          {notice}
        </p>
      )}
    </div>
  );
}
