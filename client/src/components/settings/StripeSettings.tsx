import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, QrCode } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LM_CARD } from "@/components/PageHeader";

interface StripeSettingsView {
  connected: boolean;
  mode: "test" | "live" | null;
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  apiVersion: string;
  webhookUrl: string;
  webhookEvents: string[];
  envLines: string[];
}

/**
 * "Card (link)" settings (v1.2 Stripe links): managers and above. Shows only
 * whether Stripe is connected — never a key — and, when it is not, exactly
 * what to put in the server's .env and where Stripe should send its events.
 */
export function StripeSettings() {
  const { data } = useQuery<StripeSettingsView>({ queryKey: ["/api/settings/stripe"] });
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      /* the text is on screen to copy by hand */
    }
  };

  if (!data) return null;
  return (
    <Card className={LM_CARD} data-testid="stripe-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="h-5 w-5" aria-hidden />
          Card (link) with Stripe
          <Badge variant={data.connected ? "default" : "secondary"} data-testid="stripe-status">
            {data.connected ? `Stripe connected${data.mode ? ` (${data.mode})` : ""}` : "Not set up"}
          </Badge>
        </CardTitle>
        <CardDescription>
          The till shows a QR code or sends a link; the customer pays by card on their own phone, and the sale marks
          itself paid when Stripe confirms. Hidden at the till until Stripe is set up. Refunds are made in Stripe.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!data.connected && (
          <div className="space-y-2">
            <p>
              Add these two lines to the server's <code>.env</code> (your secret key from Stripe › Developers › API keys,
              and the signing secret of the webhook below), then restart arcarna:
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs" data-testid="stripe-env-lines">
              {data.envLines.join("\n")}
            </pre>
            <p className="text-muted-foreground">
              Missing now: {[!data.hasSecretKey && "STRIPE_SECRET_KEY", !data.hasWebhookSecret && "STRIPE_WEBHOOK_SECRET"]
                .filter(Boolean)
                .join(" and ")}
              .
            </p>
          </div>
        )}
        <div className="space-y-1">
          <p className="font-medium">Webhook endpoint for Stripe</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md bg-muted px-2 py-1 text-xs">{data.webhookUrl}</code>
            <Button variant="outline" size="sm" onClick={() => void copy("url", data.webhookUrl)} aria-label="Copy the webhook URL">
              {copied === "url" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            </Button>
          </div>
          <p className="text-muted-foreground">
            Events to send: {data.webhookEvents.join(", ")}. API version {data.apiVersion}.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
