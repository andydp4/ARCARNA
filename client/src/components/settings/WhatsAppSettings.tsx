import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Copy, Check, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { apiRequest, getJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface WhatsappStatus {
  enabled: boolean;
  canSend: boolean;
  unread: number;
  webhookUrl: string;
  config: {
    hasVerifyToken: boolean;
    hasAccessToken: boolean;
    hasAppSecret: boolean;
    phoneNumberId: string | null;
    businessAccountId: string | null;
    defaultCountryCode: string;
  };
  account: {
    phoneNumber: string;
    displayName: string | null;
    status: string;
    lastWebhookAt: string | null;
    lastOutboundAt: string | null;
    lastOutboundStatus: string | null;
  } | null;
}

interface Template {
  id: string;
  templateName: string;
  category: string | null;
  language: string;
  status: string;
  body: string | null;
  variables: string[];
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${ok ? "bg-green-500" : "bg-muted-foreground/40"}`} />
      <span className="text-sm">{label}</span>
      <Badge variant={ok ? "secondary" : "outline"} className="ml-auto text-[10px]">
        {ok ? "Set" : "Missing"}
      </Badge>
    </div>
  );
}

const CHECKLIST = [
  "Create / configure a Meta developer app and add the WhatsApp product.",
  "Create or connect a WhatsApp Business Account (WABA).",
  "Add and register the business phone number.",
  "Set the webhook URL (below) and verify token in the Meta app.",
  "Add WHATSAPP_* secrets to the server environment and set WHATSAPP_ENABLED=true.",
  "Subscribe to the 'messages' webhook field.",
  "Send a test message to the number, then reply from the panel.",
  "Sync templates (button below) and submit them for Meta approval.",
];

export function WhatsAppSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data: status, isLoading } = useQuery<WhatsappStatus>({
    queryKey: ["/api/whatsapp/status"],
  });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["/api/whatsapp/templates"],
    queryFn: () => getJson("/api/whatsapp/templates"),
  });

  const syncTemplates = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/whatsapp/templates/sync");
      return res.json();
    },
    onSuccess: (data: { synced?: number; message?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/templates"] });
      toast({
        title: "Templates synced",
        description: data.message ?? `${data.synced ?? 0} template(s) synced from Meta.`,
      });
    },
    onError: (err: unknown) =>
      toast({
        title: "Sync failed",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      }),
  });

  const copyWebhook = async () => {
    if (!status?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(status.webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading WhatsApp settings…</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            WhatsApp Business
            <Badge variant={status?.enabled ? "secondary" : "outline"} className="ml-2">
              {status?.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Official WhatsApp Cloud API channel. Secrets are configured via server environment
            variables and never exposed here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Webhook URL</label>
            <div className="flex gap-2">
              <Input readOnly value={status?.webhookUrl ?? ""} className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copyWebhook} aria-label="Copy webhook URL">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter this in the Meta app webhook configuration along with your verify token.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <StatusDot ok={!!status?.config.hasVerifyToken} label="Verify token" />
            <StatusDot ok={!!status?.config.hasAccessToken} label="Access token" />
            <StatusDot ok={!!status?.config.hasAppSecret} label="App secret (HMAC)" />
            <StatusDot ok={!!status?.config.phoneNumberId} label="Phone number ID" />
            <StatusDot ok={!!status?.config.businessAccountId} label="Business account ID" />
            <StatusDot ok={!!status?.canSend} label="Outbound ready" />
          </div>

          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">Connected number</p>
            {status?.account ? (
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                <li>Number: {status.account.phoneNumber}</li>
                <li>Status: {status.account.status}</li>
                <li>Last webhook: {status.account.lastWebhookAt ?? "—"}</li>
                <li>
                  Last outbound: {status.account.lastOutboundAt ?? "—"}
                  {status.account.lastOutboundStatus ? ` (${status.account.lastOutboundStatus})` : ""}
                </li>
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                No connected number yet. Add a whatsapp_accounts row for this org with the
                phone_number_id once registered with Meta.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Setup checklist</CardTitle>
          <CardDescription>Steps to connect this number to the WhatsApp Cloud API.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            {CHECKLIST.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>Message templates</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncTemplates.mutate()}
              disabled={syncTemplates.isPending}
              data-testid="whatsapp-sync-templates"
            >
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${syncTemplates.isPending ? "animate-spin" : ""}`} />
              Sync templates
            </Button>
          </CardTitle>
          <CardDescription>
            Seed examples are marked LOCAL and must be submitted to Meta for approval before use
            outside the 24h service window.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No templates yet. Click “Sync templates”.</p>
          ) : (
            <ul className="divide-y divide-border">
              {templates.map((t) => (
                <li key={t.id} className="py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{t.templateName}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {t.language}
                    </Badge>
                    <Badge
                      variant={t.status === "APPROVED" ? "secondary" : "outline"}
                      className="text-[10px]"
                    >
                      {t.status}
                    </Badge>
                  </div>
                  {t.body && <p className="mt-1 text-xs text-muted-foreground">{t.body}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
