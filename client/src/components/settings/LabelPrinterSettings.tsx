import { useEffect } from "react";
import { Printer, Tag } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { isAtLeast } from "@shared/accessPolicy";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LM_CARD } from "@/components/PageHeader";
import {
  LabelPrintPanel,
  PrinterStatusLine,
  PrinterSupportNotice,
  usePrinterState,
  usePrinterSupport,
} from "@/components/labels/LabelPrintPanel";
import { connectPrinter, disconnectPrinter, forgetPrinter, preloadPrinterLibrary } from "@/lib/labels/niimbot";

/**
 * Settings → System → Devices: pair this device with a label printer and
 * print a test label. Everything here is per device (the printer name lives
 * in this browser), like the rest of the System tab.
 */
export function LabelPrinterSettings() {
  const { user } = useAuth();
  const canEditTemplates = isAtLeast(user?.role, "MANAGER");
  const support = usePrinterSupport();
  const printer = usePrinterState();
  const connected = printer.status === "connected" || printer.status === "printing";

  useEffect(() => {
    if (support.supported) preloadPrinterLibrary();
  }, [support.supported]);

  return (
    <Card className={LM_CARD} data-testid="card-label-printer">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Printer className="h-5 w-5" aria-hidden />
          Devices · Label printer
        </CardTitle>
        <CardDescription>
          A Niimbot B1 over Bluetooth, with 50 × 30 mm labels. Pairing is remembered on this device only — each till
          pairs once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* The templates are the shop's, not this device's, and editable by
            managers and above (server/routes/labels.ts) — shown whether or
            not this browser can reach a printer. */}
        {canEditTemplates && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
            <p className="text-sm text-muted-foreground">
              What goes on each label, which ones “Print labels” prints, and auto-print after payment.
            </p>
            <Button asChild variant="outline" data-testid="link-label-templates">
              <Link href="/settings/labels">
                <Tag className="h-4 w-4" aria-hidden />
                Open label template editor
              </Link>
            </Button>
          </div>
        )}
        {!support.supported ? (
          <PrinterSupportNotice message={support.message} />
        ) : (
          <>
            <PrinterStatusLine />
            <div className="flex flex-wrap gap-2">
              {connected ? (
                <Button variant="outline" onClick={() => void disconnectPrinter()} data-testid="label-printer-disconnect">
                  Disconnect
                </Button>
              ) : (
                <Button
                  onClick={() => void connectPrinter().catch(() => undefined)}
                  disabled={printer.status === "connecting"}
                  data-testid="label-printer-connect"
                >
                  {printer.status === "connecting" ? "Connecting…" : printer.deviceName ? "Connect" : "Pair a printer"}
                </Button>
              )}
              {printer.deviceName && (
                <Button variant="ghost" onClick={() => void forgetPrinter()} data-testid="label-printer-forget">
                  Forget this printer
                </Button>
              )}
            </div>
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm font-medium">Test label</p>
              <LabelPrintPanel
                request={{
                  kind: "product",
                  input: { name: "arcarna test label", salePrice: 1.23, barcode: "5012345678900" },
                }}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
