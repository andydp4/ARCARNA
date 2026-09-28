/**
 * Settings → Labels: the shop's label templates. Which label types "Print
 * labels" prints for an order, which details go on each label, and whether a
 * till prints them by itself after payment. Every preview is drawn by the
 * same code that prints, at the printer's real resolution, from a made-up
 * sample order — so what you see is what the Niimbot burns.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Printer, Tag } from "lucide-react";
import { PageHeader, LM_CARD } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getJson } from "@/lib/queryClient";
import { LABEL_SETTINGS_QUERY_KEY } from "@/hooks/useLabelSettings";
import { drawBitmap, PrinterStatusLine, PrinterSupportNotice, usePrinterState, usePrinterSupport } from "@/components/labels/LabelPrintPanel";
import { buildOrderLabelSpecs, type OrderLabelsOrder } from "@/lib/labels/orderLabels";
import { buildProductLabel, type LabelSpec } from "@/lib/labels/labelLayout";
import { connectPrinter, currentGeometry, printBitmap } from "@/lib/labels/niimbot";
import { canvasMeasure, renderLabel } from "@/lib/labels/renderLabel";
import {
  DEFAULT_LABEL_SETTINGS,
  LABEL_FIELD_TEXT,
  ORDER_LABEL_KINDS,
  ORDER_LABEL_TITLES,
  normalizeLabelSettings,
  type LabelSettings,
  type OrderLabelKind,
} from "@shared/labelSettings";

/** Made-up, clearly fictional sample data for the previews and test prints. */
const SAMPLE_ORDER: OrderLabelsOrder = {
  id: "0a1b2c3d-0000-4000-8000-000000000000",
  shortCode: "0a1b2c3d",
  customerName: "Priya Shah",
  fulfilmentMethod: "delivery",
  itemCount: 3,
  paymentMethodText: "Card",
  items: [
    { stockNumber: "1041", quantity: 2 },
    { stockNumber: "2210", quantity: 1 },
    { stockNumber: "3307", quantity: 6 },
  ],
  deliveryAddress: "12 High Street",
  deliveryPostcode: "AB1 2CD",
};
const SAMPLE_DUE = "14:30";
const SAMPLE_EXTRAS = { phone: "07700 900123", payLinkUrl: "https://pay.example.invalid/sample" };
const SAMPLE_PRODUCT = { name: "Sample product 500g", salePrice: 4.99, barcode: "5012345678900" };

type FieldGroup = "order" | "orderInfo" | "packaging" | "deliveryNote" | "product";
const GROUP_OF: Partial<Record<OrderLabelKind, FieldGroup>> = {
  order: "order",
  orderInfo: "orderInfo",
  packaging: "packaging",
  deliveryNote: "deliveryNote",
};

const LABEL_BLURB: Record<OrderLabelKind | "product", string> = {
  order: "Goes on the order: number, name, collection or delivery, due time, item count, and a QR that opens it on the board.",
  picking: "Stock number and quantity for each line, to pick from. A long order runs onto more than one label.",
  orderInfo: "How the order is going out and how it was paid.",
  packaging: "Straight on the bag: the customer's name, big.",
  deliveryNote: "Leaves with the driver, so it is the only label that can carry the phone and address. Printed for deliveries only.",
  product: "Shelf and product label, from the Products page.",
};

function Preview({ specs, testId }: { specs: LabelSpec[]; testId: string }) {
  const refs = useRef<Array<HTMLCanvasElement | null>>([]);
  useEffect(() => {
    specs.forEach((spec, i) => {
      const canvas = refs.current[i];
      if (canvas) drawBitmap(renderLabel(spec).bitmap, canvas);
    });
  }, [specs]);
  return (
    <div className="flex flex-wrap gap-2" data-testid={testId}>
      {specs.map((_, i) => (
        <canvas
          key={i}
          ref={(el) => (refs.current[i] = el)}
          className="h-auto w-full max-w-[240px] rounded border border-border bg-white"
          style={{ imageRendering: "pixelated" }}
          aria-label="Label preview"
        />
      ))}
    </div>
  );
}

export default function LabelSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const support = usePrinterSupport();
  const printer = usePrinterState();
  const { data, isLoading, isError } = useQuery<LabelSettings>({
    queryKey: LABEL_SETTINGS_QUERY_KEY,
    queryFn: async () => normalizeLabelSettings(await getJson("/api/labels/settings")),
  });
  const [draft, setDraft] = useState<LabelSettings>(DEFAULT_LABEL_SETTINGS);
  const [dirty, setDirty] = useState(false);
  const [printing, setPrinting] = useState<string | null>(null);
  const [specs, setSpecs] = useState<Record<string, LabelSpec[]>>({});

  useEffect(() => {
    if (data && !dirty) setDraft(data);
  }, [data, dirty]);

  // Rebuild every preview from the draft (the delivery note's phone and
  // pay-link come from the sample, never from a real customer).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const geometry = currentGeometry();
      const next: Record<string, LabelSpec[]> = {};
      for (const kind of ORDER_LABEL_KINDS) {
        next[kind] = await buildOrderLabelSpecs(kind, SAMPLE_ORDER, SAMPLE_DUE, draft, geometry, SAMPLE_EXTRAS);
      }
      next.product = [buildProductLabel(SAMPLE_PRODUCT, canvasMeasure, geometry, draft.product)];
      if (!cancelled) setSpecs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [draft, printer.model]);

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/labels/settings", draft)).json(),
    onSuccess: (saved: LabelSettings) => {
      queryClient.setQueryData(LABEL_SETTINGS_QUERY_KEY, normalizeLabelSettings(saved));
      setDirty(false);
      toast({ title: "Label templates saved", description: "Every till prints with these from now on." });
    },
    onError: (e: Error) => toast({ title: "Couldn't save the label templates", description: e.message, variant: "destructive" }),
  });

  const update = (fn: (d: LabelSettings) => LabelSettings) => {
    setDraft((d) => fn(d));
    setDirty(true);
  };
  const setField = (group: FieldGroup, key: string, value: boolean) =>
    update((d) => ({ ...d, [group]: { ...(d[group] as unknown as Record<string, boolean>), [key]: value } }));

  const testPrint = async (key: string) => {
    const list = specs[key];
    if (!list?.length) return;
    setPrinting(key);
    try {
      await connectPrinter();
      for (const spec of list) await printBitmap(renderLabel(spec).bitmap, 1);
      toast({ title: "Test label printed", description: "With the sample order, as the settings on screen stand." });
    } catch (e) {
      toast({ title: "Couldn't print", description: e instanceof Error ? e.message : "Check the printer.", variant: "destructive" });
    } finally {
      setPrinting(null);
    }
  };

  const printSetCount = useMemo(() => ORDER_LABEL_KINDS.filter((k) => draft.printSet[k]).length, [draft.printSet]);

  const card = (key: OrderLabelKind | "product", title: string) => {
    const group: FieldGroup | undefined = key === "product" ? "product" : GROUP_OF[key];
    const fields = group ? (LABEL_FIELD_TEXT[group] as Record<string, string>) : null;
    return (
      <Card key={key} className={LM_CARD} data-testid={`label-template-${key}`}>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{LABEL_BLURB[key]}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            {key !== "product" && (
              <div className="flex items-center gap-3 rounded-md border border-border p-2">
                <Switch
                  id={`printset-${key}`}
                  checked={draft.printSet[key]}
                  onCheckedChange={(v) => update((d) => ({ ...d, printSet: { ...d.printSet, [key]: v } }))}
                  data-testid={`switch-printset-${key}`}
                />
                <Label htmlFor={`printset-${key}`}>Include in “Print labels”</Label>
              </div>
            )}
            {fields ? (
              Object.entries(fields).map(([field, text]) => (
                <div key={field} className="flex items-center gap-3">
                  <Switch
                    id={`${key}-${field}`}
                    checked={(draft[group!] as unknown as Record<string, boolean>)[field]}
                    onCheckedChange={(v) => setField(group!, field, v)}
                    data-testid={`switch-${key}-${field}`}
                  />
                  <Label htmlFor={`${key}-${field}`}>{text}</Label>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Always the order number, then each line's stock number and quantity.</p>
            )}
            {key === "product" ? (
              <p className="text-xs text-muted-foreground">The product name is always printed. The cost price never is.</p>
            ) : (
              <p className="text-xs text-muted-foreground">The order number is always printed, so any label can be traced back to its order.</p>
            )}
          </div>
          <div className="space-y-2">
            <Preview specs={specs[key] ?? []} testId={`label-preview-${key}`} />
            {support.supported && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void testPrint(key)}
                disabled={printing !== null || printer.status === "connecting" || printer.status === "printing"}
                data-testid={`button-test-print-${key}`}
              >
                {printing === key ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Printer className="h-4 w-4" aria-hidden />}
                Test print
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <Link href="/settings?tab=system" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Settings
      </Link>
      <PageHeader
        eyebrow="Settings"
        title="Label templates"
        icon={Tag}
        question="What goes on each label, and which ones print?"
        explanation="Changes apply to every till once saved. Previews use a made-up sample order, drawn exactly as the Niimbot B1 prints them (50 × 30 mm)."
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => update(() => DEFAULT_LABEL_SETTINGS)}
              data-testid="button-labels-reset"
            >
              Reset to defaults
            </Button>
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid="button-labels-save">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Save
            </Button>
          </div>
        }
      />

      {isError && <p className="text-sm text-destructive">Couldn't load the label settings. The defaults are shown.</p>}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <Card className={LM_CARD}>
            <CardHeader>
              <CardTitle className="text-base">Printing</CardTitle>
              <CardDescription>
                “Print labels” — on a board card, in an order's details, and on the till after payment — prints {printSetCount} label
                type{printSetCount === 1 ? "" : "s"} for an order (the Delivery note only for deliveries). Each type can still be
                reprinted on its own from the order's details.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Switch
                  id="auto-print"
                  checked={draft.autoPrintAfterPayment}
                  onCheckedChange={(v) => update((d) => ({ ...d, autoPrintAfterPayment: v }))}
                  data-testid="switch-auto-print"
                />
                <Label htmlFor="auto-print">Print the labels automatically after payment</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Only on a till whose printer is already connected (Settings → System → Devices). A browser only lets arcarna open
                the Bluetooth chooser from a tap, so an unpaired till shows a Print labels button instead.
              </p>
              {support.supported ? <PrinterStatusLine /> : <PrinterSupportNotice message={support.message} />}
            </CardContent>
          </Card>

          {ORDER_LABEL_KINDS.map((k) => card(k, ORDER_LABEL_TITLES[k]))}
          {card("product", "Product label")}
        </>
      )}
    </div>
  );
}
