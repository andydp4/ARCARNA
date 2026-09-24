import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Bluetooth, BluetoothOff, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { APP_BASE } from "@/lib/appPaths";
import type { MonoBitmap } from "@/lib/labels/bitmap";
import {
  buildOrderLabel,
  buildProductLabel,
  orderLabelUrl,
  type LabelGeometry,
  type LabelSpec,
  type OrderLabelInput,
  type ProductLabelInput,
} from "@/lib/labels/labelLayout";
import {
  connectPrinter,
  currentGeometry,
  getPrinterState,
  preloadPrinterLibrary,
  printBitmap,
  subscribePrinter,
} from "@/lib/labels/niimbot";
import { currentSupportEnv, detectPrinterSupport } from "@/lib/labels/printerSupport";
import { canvasMeasure, renderLabel } from "@/lib/labels/renderLabel";

export type LabelRequest =
  | { kind: "order"; input: OrderLabelInput }
  | { kind: "product"; input: ProductLabelInput };

export function usePrinterState() {
  return useSyncExternalStore(subscribePrinter, getPrinterState, getPrinterState);
}

export function usePrinterSupport() {
  return useMemo(() => detectPrinterSupport(currentSupportEnv()), []);
}

export function buildLabelSpec(request: LabelRequest, geometry: LabelGeometry): LabelSpec {
  if (request.kind === "order") {
    const url = orderLabelUrl(window.location.origin, APP_BASE, request.input.orderId);
    return buildOrderLabel(request.input, url, canvasMeasure, geometry);
  }
  return buildProductLabel(request.input, canvasMeasure, geometry);
}

/** Paint the packed 1-bit page, so the preview is exactly what the head will burn. */
function drawBitmap(bitmap: MonoBitmap, canvas: HTMLCanvasElement) {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.createImageData(bitmap.width, bitmap.height);
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const black = (bitmap.data[y * bitmap.bytesPerRow + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
      const i = (y * bitmap.width + x) * 4;
      const v = black ? 0 : 255;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export function PrinterSupportNotice({ message }: { message: string }) {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground"
      data-testid="label-printer-unsupported"
    >
      <BluetoothOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <p>{message}</p>
    </div>
  );
}

export function PrinterStatusLine() {
  const printer = usePrinterState();
  const connected = printer.status === "connected" || printer.status === "printing";
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite" data-testid="label-printer-status">
      <Bluetooth className="h-4 w-4" aria-hidden />
      {printer.status === "connecting"
        ? "Connecting to the printer…"
        : connected
          ? `Connected to ${printer.deviceName ?? "the printer"}${printer.batteryPercent != null ? ` · battery ${printer.batteryPercent}%` : ""}`
          : printer.deviceName
            ? `Not connected · this device uses ${printer.deviceName}`
            : "No printer connected on this device yet"}
    </p>
  );
}

/**
 * Preview + Print for one label. No dialog of its own: the product page wraps
 * it in one, the Ops board shows it inline (the till never mounts a dialog
 * over the order form — see OpsDetailsSheet).
 */
export function LabelPrintPanel({ request, onPrinted }: { request: LabelRequest; onPrinted?: () => void }) {
  const support = usePrinterSupport();
  const printer = usePrinterState();
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [copies, setCopies] = useState(1);
  const [renderError, setRenderError] = useState<string | null>(null);
  const busy = printer.status === "connecting" || printer.status === "printing";

  useEffect(() => {
    if (support.supported) preloadPrinterLibrary();
  }, [support.supported]);

  // Re-render the preview whenever the label or the connected model changes.
  const requestKey = JSON.stringify(request);
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    try {
      const { bitmap } = renderLabel(buildLabelSpec(request, currentGeometry()));
      drawBitmap(bitmap, canvas);
      setRenderError(null);
    } catch (e) {
      console.error("[labels] preview failed", e);
      setRenderError("Could not draw this label.");
    }
    // requestKey stands in for `request`, which is a fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, printer.model]);

  const onPrint = async () => {
    try {
      // Connect first (inside the click, for the Bluetooth chooser), then
      // render at the connected model's resolution.
      await connectPrinter();
      const { bitmap } = renderLabel(buildLabelSpec(request, currentGeometry()));
      await printBitmap(bitmap, copies);
      onPrinted?.();
    } catch {
      // The plain-English message is already in printer.error.
    }
  };

  return (
    <div className="space-y-3" data-testid="label-print-panel">
      <canvas
        ref={previewRef}
        aria-label={request.kind === "order" ? "Order label preview" : "Product label preview"}
        role="img"
        className="w-full max-w-sm rounded border border-border bg-white"
        style={{ imageRendering: "pixelated" }}
        data-testid="label-preview"
      />
      {renderError && <p className="text-sm text-destructive">{renderError}</p>}

      {!support.supported ? (
        <PrinterSupportNotice message={support.message} />
      ) : (
        <>
          <PrinterStatusLine />
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-24 space-y-1">
              <Label htmlFor="label-copies">Copies</Label>
              <Input
                id="label-copies"
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                data-testid="label-copies"
              />
            </div>
            <Button size="touch" onClick={onPrint} disabled={busy} data-testid="label-print">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Printer className="h-4 w-4" aria-hidden />}
              {printer.status === "connecting" ? "Connecting…" : printer.status === "printing" ? "Printing…" : "Print"}
            </Button>
          </div>
          {printer.status === "printing" && printer.progress != null && (
            <Progress value={printer.progress} aria-label="Printing progress" />
          )}
          {printer.error && (
            <p role="alert" className="text-sm text-destructive" data-testid="label-print-error">
              {printer.error}
            </p>
          )}
          {printer.notice && !printer.error && (
            <p className="text-sm text-muted-foreground" data-testid="label-print-notice">
              {printer.notice}
            </p>
          )}
        </>
      )}
    </div>
  );
}
