import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { apiFetch } from "@/lib/appPaths";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Mail, ArrowLeft } from "lucide-react";

type ReceiptSettings = {
  receiptTemplateHtml: string;
  defaultTemplate: string;
  resendConfigured: boolean;
  fromEmail: string | null;
};

export default function ReceiptSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [template, setTemplate] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");

  const { data, isLoading } = useQuery<ReceiptSettings>({
    queryKey: ["/api/receipts/settings"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  useEffect(() => {
    if (data) {
      setTemplate(data.receiptTemplateHtml || data.defaultTemplate || "");
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/receipts/settings", {
        receiptTemplateHtml: template || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts/settings"] });
      toast({ title: "Receipt template saved" });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const loadPreview = async () => {
    try {
      const qs = new URLSearchParams();
      if (template.trim()) qs.set("template", template);
      const res = await apiFetch(`/api/receipts/preview?${qs.toString()}`);
      const html = await res.text();
      setPreviewHtml(html);
    } catch (e) {
      toast({
        title: "Preview failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (!isLoading && data) {
      void loadPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, data?.receiptTemplateHtml]);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Settings
          </Button>
        </Link>
      </div>
      <PageHeader
        icon={Mail}
        title="Receipt Settings"
        question="What do receipts show?"
        explanation="Customise the HTML template sent to customers after checkout."
      />

      <Card>
        <CardHeader>
          <CardTitle>Delivery</CardTitle>
          <CardDescription>Receipts are sent via Resend when configured.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant={data?.resendConfigured ? "default" : "secondary"}>
            {data?.resendConfigured ? "Resend configured" : "RESEND_API_KEY not set (no-op)"}
          </Badge>
          {data?.fromEmail && <Badge variant="outline">From: {data.fromEmail}</Badge>}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Template</CardTitle>
            <CardDescription>
              Variables: {"{{org.name}}"}, {"{{customer.name}}"}, {"{{order.total}}"}, line block
              {" {{#order.lines}}"}…{"{{/order.lines}}"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="receipt-template">HTML template</Label>
              <Textarea
                id="receipt-template"
                className="font-mono text-xs min-h-[320px]"
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTemplate(data?.defaultTemplate ?? "")}
              >
                Reset to default
              </Button>
              <Button type="button" variant="outline" onClick={() => void loadPreview()}>
                Refresh preview
              </Button>
              <Button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving…" : "Save template"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live preview</CardTitle>
            <CardDescription>Sample order rendered with your template</CardDescription>
          </CardHeader>
          <CardContent>
            {previewHtml ? (
              <iframe
                title="Receipt preview"
                className="w-full min-h-[420px] rounded-md border bg-white"
                srcDoc={previewHtml}
                sandbox=""
              />
            ) : (
              <p className="text-sm text-muted-foreground">Loading preview…</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
