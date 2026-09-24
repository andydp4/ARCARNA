/**
 * Card (link) at the till (v1.2 Stripe links).
 *
 * The sale is already recorded, its card-link part waiting. This makes the
 * Stripe link for exactly that amount, shows it as a large QR the customer
 * scans with their own phone (plus a copyable link, and "Send by WhatsApp"
 * when WhatsApp is set up — the number is looked up on the server and never
 * shown here), and waits. When Stripe confirms, it says so. Cancel, or the
 * link running out, brings the till back to choosing how they will pay.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, CreditCard, DollarSign, Loader2, MessageCircle, RefreshCw, Smartphone, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiRequest, getJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type CardLinkView = {
  orderId: string;
  leg: { id: string; amount: number; status: string; method: string } | null;
  link: { id: string; status: string; url: string | null; amount: number; currency: string; expiresAt: string } | null;
};

type Stage = "making" | "waiting" | "paid" | "choose" | "error";

const POLL_MS = 3000;
/** Every few polls, ask the server to check with Stripe too, in case the webhook is slow. */
const REFRESH_EVERY = 5;

function formatMoney(amount: number, currency = "GBP"): string {
  return currency.toUpperCase() === "GBP" ? `£${amount.toFixed(2)}` : `${amount.toFixed(2)} ${currency.toUpperCase()}`;
}

function minutesLeft(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "expired";
  const mins = Math.ceil(ms / 60_000);
  return mins >= 90 ? `${Math.round(mins / 60)} hours left` : `${mins} min left`;
}

export function CardLinkDialog({
  orderId,
  amount,
  longLived,
  whatsappAvailable,
  hasCustomer,
  onFinished,
}: {
  orderId: string;
  amount: number;
  /** Phone and WhatsApp orders get a day to pay; a customer at the counter, half an hour. */
  longLived: boolean;
  whatsappAvailable: boolean;
  hasCustomer: boolean;
  /** Paid, or paid another way: the till is free for the next sale. */
  onFinished: (how: "paid" | "retendered" | "left_waiting") => void;
}) {
  const { toast } = useToast();
  const [stage, setStage] = useState<Stage>("making");
  const [view, setView] = useState<CardLinkView | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const pollCount = useRef(0);

  const apply = useCallback((next: CardLinkView) => {
    setView(next);
    if (next.leg?.status === "paid") {
      setStage("paid");
    } else if (next.link?.status === "open" && next.link.url) {
      setStage("waiting");
    } else {
      setStage("choose");
    }
  }, []);

  const makeLink = useCallback(async () => {
    setStage("making");
    setError(null);
    try {
      const res = await apiRequest("POST", `/api/card-links/${orderId}`, longLived ? { minutes: 24 * 60 } : {});
      apply((await res.json()) as CardLinkView);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not make the card link");
      setStage("error");
    }
  }, [apply, orderId, longLived]);

  // Opened again (from the Ops board, or a second time): pick up where the
  // link stands. Only a sale that never had one gets a new link straight away.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await getJson<CardLinkView>(`/api/card-links/${orderId}`);
        if (cancelled) return;
        if (current.leg?.status === "awaiting" && !current.link) {
          void makeLink();
        } else {
          apply(current);
        }
      } catch {
        if (!cancelled) void makeLink();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // The QR is drawn here, from the link, so nothing about it leaves the till.
  const url = view?.link?.status === "open" ? view.link.url : null;
  useEffect(() => {
    if (!url) {
      setQr(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "M" })
      .then((data) => !cancelled && setQr(data))
      .catch(() => !cancelled && setQr(null));
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Wait for Stripe.
  useEffect(() => {
    if (stage !== "waiting") return;
    const timer = window.setInterval(async () => {
      setNow(Date.now());
      pollCount.current += 1;
      const refresh = pollCount.current % REFRESH_EVERY === 0 ? "?refresh=1" : "";
      try {
        apply(await getJson<CardLinkView>(`/api/card-links/${orderId}${refresh}`));
      } catch {
        // A missed poll is not news; the next one will try again.
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [apply, orderId, stage]);

  const paidAmount = view?.leg?.amount ?? amount;
  useEffect(() => {
    if (stage === "paid") {
      toast({ title: "Card payment received", description: `${formatMoney(paidAmount)} paid by card link.` });
    }
    // Once per arrival at "paid", not on every amount re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const cancel = async () => {
    setBusy(true);
    try {
      const res = await apiRequest("POST", `/api/card-links/${orderId}/cancel`, {});
      apply((await res.json()) as CardLinkView);
    } catch (e) {
      toast({ title: "Could not cancel the link", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
      // It may have been paid in the meantime.
      try {
        apply(await getJson<CardLinkView>(`/api/card-links/${orderId}?refresh=1`));
      } catch {
        /* keep what we have */
      }
    } finally {
      setBusy(false);
    }
  };

  const retender = async (method: "cash" | "card" | "transfer") => {
    setBusy(true);
    try {
      await apiRequest("POST", `/api/card-links/${orderId}/retender`, { method });
      toast({ title: "Payment recorded", description: `Taken as ${method === "card" ? "card on the terminal" : method}.` });
      onFinished("retendered");
    } catch (e) {
      toast({ title: "Could not record the payment", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Could not copy", description: "Select the link and copy it by hand.", variant: "destructive" });
    }
  };

  const sendWhatsapp = async () => {
    setBusy(true);
    try {
      await apiRequest("POST", `/api/card-links/${orderId}/whatsapp`, {});
      toast({ title: "Link sent by WhatsApp" });
    } catch (e) {
      toast({ title: "Could not send it by WhatsApp", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const linkAmount = view?.leg?.amount ?? amount;
  const currency = view?.link?.currency ?? "GBP";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Closing while it waits leaves the order on the Ops board as
        // "Awaiting card payment"; it can be picked up from there.
        if (!open && stage !== "paid") onFinished("left_waiting");
        if (!open && stage === "paid") onFinished("paid");
      }}
    >
      <DialogContent className="max-w-md" data-testid="card-link-dialog">
        <DialogHeader>
          <DialogTitle>Card (link) · {formatMoney(linkAmount, currency)}</DialogTitle>
          <DialogDescription>
            {stage === "paid"
              ? "Stripe has confirmed the payment."
              : stage === "choose"
                ? "The link is closed. How will they pay instead?"
                : "The customer scans this with their phone camera and pays by card on their own phone."}
          </DialogDescription>
        </DialogHeader>

        {stage === "making" && (
          <div className="flex min-h-[240px] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Making the link…
          </div>
        )}

        {stage === "error" && (
          <div className="space-y-3">
            <p className="text-sm text-destructive" role="alert">{error}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void makeLink()} disabled={busy} className="min-h-[44px]">
                <RefreshCw className="mr-1 h-4 w-4" aria-hidden /> Try again
              </Button>
              <Button variant="outline" onClick={() => setStage("choose")} className="min-h-[44px]">
                Take another payment
              </Button>
            </div>
          </div>
        )}

        {stage === "waiting" && url && (
          <div className="space-y-3">
            <div className="flex justify-center rounded-lg bg-white p-3">
              {qr ? (
                <img src={qr} alt="QR code for the card payment link" className="h-64 w-64" data-testid="card-link-qr" />
              ) : (
                <div className="flex h-64 w-64 items-center justify-center text-sm text-neutral-500">Drawing the QR…</div>
              )}
            </div>
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Waiting for payment · {view?.link ? minutesLeft(view.link.expiresAt, now) : ""}
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={url}
                aria-label="Payment link"
                className="min-h-[44px] flex-1 truncate rounded-md border border-input bg-background px-2 text-xs"
                onFocus={(e) => e.currentTarget.select()}
                data-testid="card-link-url"
              />
              <Button variant="outline" onClick={() => void copy()} className="min-h-[44px]" aria-label="Copy the link">
                {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {whatsappAvailable && (
                <Button
                  variant="outline"
                  onClick={() => void sendWhatsapp()}
                  disabled={busy || !hasCustomer}
                  title={hasCustomer ? undefined : "Pick the customer on the sale to send them the link"}
                  className="min-h-[44px]"
                  data-testid="card-link-whatsapp"
                >
                  <MessageCircle className="mr-1 h-4 w-4" aria-hidden /> Send by WhatsApp
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => void cancel()}
                disabled={busy}
                className="min-h-[44px] text-destructive hover:text-destructive"
                data-testid="card-link-cancel"
              >
                <X className="mr-1 h-4 w-4" aria-hidden /> Cancel link
              </Button>
            </div>
          </div>
        )}

        {stage === "paid" && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-lg font-semibold" data-testid="card-link-paid">
              <Check className="h-6 w-6" aria-hidden /> Paid {formatMoney(linkAmount, currency)}
            </p>
            <Button className="min-h-[44px] w-full" onClick={() => onFinished("paid")}>
              Done
            </Button>
          </div>
        )}

        {stage === "choose" && (
          <div className="space-y-3" data-testid="card-link-choose">
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" className="min-h-[60px] flex-col" disabled={busy} onClick={() => void retender("cash")}>
                <DollarSign className="h-5 w-5" aria-hidden /> Cash
              </Button>
              <Button variant="outline" className="min-h-[60px] flex-col" disabled={busy} onClick={() => void retender("card")}>
                <CreditCard className="h-5 w-5" aria-hidden /> Card
              </Button>
              <Button variant="outline" className="min-h-[60px] flex-col" disabled={busy} onClick={() => void retender("transfer")}>
                <Smartphone className="h-5 w-5" aria-hidden /> Transfer
              </Button>
            </div>
            <Button variant="secondary" className="min-h-[44px] w-full" disabled={busy} onClick={() => void makeLink()}>
              <RefreshCw className="mr-1 h-4 w-4" aria-hidden /> New card link
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
