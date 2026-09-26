import { useMemo, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, APP_BASE } from "@/lib/appPaths";
import {
  buildDeliveryNoteLabel,
  buildOrderInfoLabel,
  buildOrderLabel,
  buildPackagingLabel,
  buildPickingLabels,
  orderLabelUrl,
  type LabelSpec,
} from "@/lib/labels/labelLayout";
import { connectPrinter, currentGeometry, printBitmap } from "@/lib/labels/niimbot";
import { canvasMeasure, renderLabel } from "@/lib/labels/renderLabel";
import { PrinterStatusLine, PrinterSupportNotice, usePrinterState, usePrinterSupport } from "./LabelPrintPanel";

export interface OrderLabelsOrder {
  id: string;
  shortCode: string;
  customerName: string | null;
  fulfilmentMethod: "collection" | "delivery";
  itemCount: number;
  /** Already formatted, e.g. formatPaymentLabel(order.paymentMethod). */
  paymentMethodText: string;
  items: Array<{ stockNumber: string | null; quantity: number }>;
  deliveryAddress?: string | null;
  deliveryPostcode?: string | null;
}

type LabelJobKey = "order" | "picking" | "orderInfo" | "packaging" | "deliveryNote";

/**
 * The phone is fetched fresh from the same on-demand, never-cached reveal the
 * board's "Show number to call" uses (OpsCustomerCall) — never read from the
 * board or query cache, and never held here past this one print.
 */
async function revealPhone(orderId: string): Promise<string | null> {
  try {
    const res = await apiFetch(`/api/orders/${orderId}/customer-phone`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    return typeof body?.phone === "string" ? body.phone : null;
  } catch {
    return null;
  }
}

/** Only an OPEN Stripe Card (link) checkout is worth a "Scan to pay" QR. */
async function openCardLinkUrl(orderId: string): Promise<string | null> {
  try {
    const res = await apiFetch(`/api/card-links/${orderId}`, { credentials: "include" });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    return body?.link?.status === "open" && typeof body.link.url === "string" ? body.link.url : null;
  } catch {
    return null;
  }
}

/**
 * Niimbot labels for one order (owner brief: 3-4 label types per order,
 * "option to reprint them all or just one type"). Each job builds its own
 * page(s) and is printed as its own pass — the printer takes one bitmap image
 * at a time, so "Print all" is a sequence of individual prints, not one job.
 */
export function OrderLabelPrintPanel({ order, dueText }: { order: OrderLabelsOrder; dueText: string | null }) {
  const support = usePrinterSupport();
  const printer = usePrinterState();
  const [busy, setBusy] = useState<LabelJobKey | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const jobs = useMemo<{ key: LabelJobKey; title: string }[]>(() => {
    const list: { key: LabelJobKey; title: string }[] = [
      { key: "order", title: "Order label" },
      { key: "picking", title: order.items.length ? `Picking list (${order.items.length})` : "Picking list" },
      { key: "orderInfo", title: "Type & payment" },
      { key: "packaging", title: "Packaging" },
    ];
    if (order.fulfilmentMethod === "delivery") list.push({ key: "deliveryNote", title: "Delivery note" });
    return list;
  }, [order.items.length, order.fulfilmentMethod]);

  const buildSpecs = async (key: LabelJobKey): Promise<LabelSpec[]> => {
    const geometry = currentGeometry();
    switch (key) {
      case "order": {
        const url = orderLabelUrl(window.location.origin, APP_BASE, order.id);
        return [
          buildOrderLabel(
            {
              orderId: order.id,
              shortCode: order.shortCode,
              customerName: order.customerName,
              fulfilmentMethod: order.fulfilmentMethod,
              dueText,
              itemCount: order.itemCount,
            },
            url,
            canvasMeasure,
            geometry,
          ),
        ];
      }
      case "picking":
        return buildPickingLabels(
          { shortCode: order.shortCode, lines: order.items.map((i) => ({ stockNumber: i.stockNumber ?? "-", quantity: i.quantity })) },
          canvasMeasure,
          geometry,
        );
      case "orderInfo":
        return [
          buildOrderInfoLabel(
            {
              shortCode: order.shortCode,
              customerName: order.customerName,
              fulfilmentMethod: order.fulfilmentMethod,
              paymentMethodText: order.paymentMethodText,
            },
            canvasMeasure,
            geometry,
          ),
        ];
      case "packaging":
        return [buildPackagingLabel({ shortCode: order.shortCode, customerName: order.customerName }, canvasMeasure, geometry)];
      case "deliveryNote": {
        const [phone, payLinkUrl] = await Promise.all([revealPhone(order.id), openCardLinkUrl(order.id)]);
        return [
          buildDeliveryNoteLabel(
            {
              shortCode: order.shortCode,
              customerName: order.customerName,
              phone,
              address: order.deliveryAddress ?? null,
              postcode: order.deliveryPostcode ?? null,
              paymentMethodText: order.paymentMethodText,
              payLinkUrl,
            },
            canvasMeasure,
            geometry,
          ),
        ];
      }
    }
  };

  const printSpecs = async (specs: LabelSpec[]) => {
    for (const spec of specs) {
      const { bitmap } = renderLabel(spec);
      await printBitmap(bitmap, 1);
    }
  };

  const printOne = async (key: LabelJobKey) => {
    setError(null);
    setNotice(null);
    setBusy(key);
    try {
      await connectPrinter();
      await printSpecs(await buildSpecs(key));
      setNotice(`Printed ${jobs.find((j) => j.key === key)?.title ?? "label"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not print this label.");
    } finally {
      setBusy(null);
    }
  };

  const printAll = async () => {
    setError(null);
    setNotice(null);
    setBusy("all");
    try {
      await connectPrinter();
      for (const job of jobs) {
        await printSpecs(await buildSpecs(job.key));
      }
      setNotice(`Printed ${jobs.length} labels.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not print all the labels.");
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
        <Button size="touch" onClick={printAll} disabled={anyBusy} data-testid="button-print-all-labels">
          {busy === "all" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Printer className="h-4 w-4" aria-hidden />}
          Print all ({jobs.length})
        </Button>
        {jobs.map((job) => (
          <Button
            key={job.key}
            size="touch"
            variant="outline"
            onClick={() => printOne(job.key)}
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
