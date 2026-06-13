import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  MessageCircle,
  X,
  ChevronLeft,
  Search,
  Send,
  User,
  UserPlus,
  Link2,
  ShoppingCart,
  ExternalLink,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiRequest, getJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  migrateStorageKey,
  STORAGE_WHATSAPP_SOUND,
  STORAGE_WHATSAPP_SOUND_LEGACY,
} from "@shared/storageKeys";
import { stashWhatsappDraft } from "@/lib/whatsappDraft";

interface WhatsappStatus {
  enabled: boolean;
  canSend: boolean;
  unread: number;
  account: { phoneNumber: string; displayName: string | null; status: string } | null;
}

interface ConversationListItem {
  id: string;
  phone: string;
  waId: string;
  profileName: string | null;
  customerId: string | null;
  customerName: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  status: string;
}

interface WhatsappMessage {
  id: string;
  direction: "inbound" | "outbound";
  messageType: string;
  body: string | null;
  status: string;
  sentByUserId: string | null;
  createdAt: string;
}

interface ParsedItem {
  productId?: string;
  sku?: string;
  name: string;
  quantity: number;
  matched: boolean;
}

interface OrderIntent {
  id: string;
  parsedItems: ParsedItem[];
  rawText: string | null;
  status: string;
  createdAt: string;
}

interface ConversationDetail {
  conversation: ConversationListItem;
  messages: WhatsappMessage[];
  withinServiceWindow: boolean;
}

interface Template {
  id: string;
  templateName: string;
  language: string;
  status: string;
  body: string | null;
  variables: string[];
}

interface CustomerLite {
  id: string;
  name: string;
  phone: string | null;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function WhatsAppPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    try {
      return migrateStorageKey(STORAGE_WHATSAPP_SOUND_LEGACY, STORAGE_WHATSAPP_SOUND) === "1";
    } catch {
      return false;
    }
  });
  const prevUnread = useRef<number | null>(null);

  const { data: status } = useQuery<WhatsappStatus>({
    queryKey: ["/api/whatsapp/status"],
    refetchInterval: 30000,
  });

  // New-message notification: toast (and optional sound) when unread rises.
  useEffect(() => {
    const current = status?.unread ?? 0;
    if (prevUnread.current === null) {
      prevUnread.current = current;
      return;
    }
    if (current > prevUnread.current) {
      if (!open) {
        toast({ title: "New WhatsApp message", description: "You have unread WhatsApp messages." });
      }
      if (soundOn) {
        try {
          const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
          if (Ctx) {
            const ctx = new Ctx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = 660;
            gain.gain.value = 0.05;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.15);
          }
        } catch {
          /* ignore audio errors */
        }
      }
    }
    prevUnread.current = current;
  }, [status?.unread, open, soundOn, toast]);

  const toggleSound = () => {
    setSoundOn((v) => {
      const next = !v;
      try {
        localStorage.setItem(STORAGE_WHATSAPP_SOUND, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const { data: conversations = [], isLoading: loadingList } = useQuery<ConversationListItem[]>({
    queryKey: ["/api/whatsapp/conversations", search],
    queryFn: () =>
      getJson(
        `/api/whatsapp/conversations${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`,
      ),
    enabled: open && !activeId,
    refetchInterval: open && !activeId ? 30000 : false,
  });

  const { data: detail } = useQuery<ConversationDetail>({
    queryKey: ["/api/whatsapp/conversations", activeId, "detail"],
    queryFn: () => getJson(`/api/whatsapp/conversations/${activeId}`),
    enabled: open && !!activeId,
    refetchInterval: open && !!activeId ? 15000 : false,
  });

  const { data: intents = [] } = useQuery<OrderIntent[]>({
    queryKey: ["/api/whatsapp/conversations", activeId, "intents"],
    queryFn: () => getJson(`/api/whatsapp/conversations/${activeId}/intents`),
    enabled: open && !!activeId,
  });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["/api/whatsapp/templates"],
    queryFn: () => getJson("/api/whatsapp/templates"),
    enabled: open && !!activeId,
  });

  const refreshConversation = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations", activeId, "detail"] });
    queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations"] });
    queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/status"] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/whatsapp/conversations/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/status"] });
    },
  });

  const sendReply = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", `/api/whatsapp/conversations/${activeId}/reply`, { text });
      return res.json();
    },
    onSuccess: () => {
      setReply("");
      refreshConversation();
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not send",
        description: err instanceof Error ? err.message : "Failed to send message",
        variant: "destructive",
      });
    },
  });

  const createCustomer = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/whatsapp/conversations/${activeId}/create-customer`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Customer created", description: "Linked to this conversation." });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      refreshConversation();
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not create customer",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      }),
  });

  const linkCustomer = useMutation({
    mutationFn: async (customerId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/whatsapp/conversations/${activeId}/link-customer`,
        { customerId },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Customer linked" });
      refreshConversation();
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not link customer",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      }),
  });

  const sendTemplate = useMutation({
    mutationFn: async (vars: { templateName: string; language: string; bodyParams: string[] }) => {
      const res = await apiRequest(
        "POST",
        `/api/whatsapp/conversations/${activeId}/send-template`,
        vars,
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Template sent" });
      refreshConversation();
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not send template",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      }),
  });

  const createDraftOrder = useMutation({
    mutationFn: async (intentId?: string) => {
      const res = await apiRequest(
        "POST",
        `/api/whatsapp/conversations/${activeId}/create-draft-order`,
        intentId ? { intentId } : {},
      );
      return res.json();
    },
    onSuccess: (data: { prefill: { customerId: string | null; conversationId: string; note?: string; items: ParsedItem[] } }) => {
      stashWhatsappDraft({
        conversationId: data.prefill.conversationId,
        customerId: data.prefill.customerId,
        note: data.prefill.note,
        items: data.prefill.items.map((i) => ({
          productId: i.productId,
          sku: i.sku,
          name: i.name,
          quantity: i.quantity,
        })),
      });
      setOpen(false);
      navigate("/pos");
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not create draft order",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      }),
  });

  const openConversation = (id: string) => {
    setActiveId(id);
    markRead.mutate(id);
  };

  const unread = status?.unread ?? 0;

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full p-0 shadow-lg"
        data-testid="whatsapp-launcher"
        aria-label="WhatsApp messages"
      >
        <MessageCircle className="h-5 w-5" />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
            data-testid="whatsapp-unread-badge"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div
          className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl"
          data-testid="whatsapp-panel"
          role="dialog"
          aria-label="WhatsApp conversations"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              {activeId && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setActiveId(null)}
                  aria-label="Back to conversations"
                  data-testid="whatsapp-back"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              )}
              <MessageCircle className="h-5 w-5 text-primary" />
              <span className="font-semibold">WhatsApp</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={toggleSound}
                aria-label={soundOn ? "Mute new-message sound" : "Enable new-message sound"}
                data-testid="whatsapp-sound-toggle"
              >
                {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setOpen(false)}
                aria-label="Close WhatsApp panel"
                data-testid="whatsapp-close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {status && !status.enabled && (
            <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
              WhatsApp is not enabled. Configure it in Settings → Integrations.
            </div>
          )}

          {!activeId ? (
            <ConversationList
              conversations={conversations}
              loading={loadingList}
              search={search}
              onSearch={setSearch}
              onOpen={openConversation}
            />
          ) : (
            <ConversationView
              detail={detail}
              intents={intents}
              templates={templates}
              reply={reply}
              onReply={setReply}
              onSend={() => reply.trim() && sendReply.mutate(reply.trim())}
              sending={sendReply.isPending}
              canSend={status?.canSend ?? false}
              onSendTemplate={(vars) => sendTemplate.mutate(vars)}
              sendingTemplate={sendTemplate.isPending}
              onCreateCustomer={() => createCustomer.mutate()}
              onLinkCustomer={(id) => linkCustomer.mutate(id)}
              onCreateDraftOrder={(intentId) => createDraftOrder.mutate(intentId)}
              busy={createCustomer.isPending || linkCustomer.isPending || createDraftOrder.isPending}
              onViewCustomer={() => {
                setOpen(false);
                navigate("/customers");
              }}
            />
          )}
        </div>
      )}
    </>
  );
}

function ConversationList({
  conversations,
  loading,
  search,
  onSearch,
  onOpen,
}: {
  conversations: ConversationListItem[];
  loading: boolean;
  search: string;
  onSearch: (v: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name, phone, or message"
            className="pl-8"
            data-testid="whatsapp-search"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        {loading ? (
          <p className="p-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : conversations.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground" data-testid="whatsapp-empty">
            No conversations yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50"
                  data-testid={`whatsapp-conversation-${c.id}`}
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                    {c.customerId ? <User className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">
                        {c.customerName || c.profileName || c.phone}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatTime(c.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {c.lastMessagePreview || c.phone}
                      </span>
                      {c.unreadCount > 0 && (
                        <Badge className="h-5 min-w-5 justify-center px-1 text-[10px]">
                          {c.unreadCount}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1">
                      <Badge
                        variant={c.customerId ? "secondary" : "outline"}
                        className="text-[10px]"
                      >
                        {c.customerId ? "Linked customer" : "Unlinked"}
                      </Badge>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </>
  );
}

function ConversationView({
  detail,
  intents,
  templates,
  reply,
  onReply,
  onSend,
  sending,
  canSend,
  onSendTemplate,
  sendingTemplate,
  onCreateCustomer,
  onLinkCustomer,
  onCreateDraftOrder,
  onViewCustomer,
  busy,
}: {
  detail: ConversationDetail | undefined;
  intents: OrderIntent[];
  templates: Template[];
  reply: string;
  onReply: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  canSend: boolean;
  onSendTemplate: (vars: { templateName: string; language: string; bodyParams: string[] }) => void;
  sendingTemplate: boolean;
  onCreateCustomer: () => void;
  onLinkCustomer: (customerId: string) => void;
  onCreateDraftOrder: (intentId?: string) => void;
  onViewCustomer: () => void;
  busy: boolean;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  if (!detail) {
    return <p className="flex-1 p-4 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  const { conversation, messages, withinServiceWindow } = detail;
  const suggestion = intents.find((i) => i.status === "suggested") ?? intents[0];

  return (
    <>
      <div className="space-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">
              {conversation.customerName || conversation.profileName || conversation.phone}
            </p>
            <p className="text-xs text-muted-foreground">+{conversation.waId}</p>
          </div>
          <Badge variant={conversation.customerId ? "secondary" : "outline"} className="shrink-0 text-[10px]">
            {conversation.customerId ? "Linked" : "Unlinked"}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-2">
          {conversation.customerId ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={onViewCustomer}
              data-testid="whatsapp-view-customer"
            >
              <ExternalLink className="mr-1 h-3.5 w-3.5" /> View customer
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={onCreateCustomer}
                disabled={busy}
                data-testid="whatsapp-create-customer"
              >
                <UserPlus className="mr-1 h-3.5 w-3.5" /> Create customer
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setLinkOpen((v) => !v)}
                disabled={busy}
                data-testid="whatsapp-link-customer-toggle"
              >
                <Link2 className="mr-1 h-3.5 w-3.5" /> Link existing
              </Button>
            </>
          )}
        </div>

        {linkOpen && !conversation.customerId && (
          <LinkCustomerPicker
            onPick={(id) => {
              setLinkOpen(false);
              onLinkCustomer(id);
            }}
          />
        )}

        {suggestion && suggestion.parsedItems.length > 0 && (
          <div
            className="rounded-md border border-border bg-muted/40 p-2"
            data-testid="whatsapp-order-suggestion"
          >
            <p className="mb-1 text-xs font-medium">Suggested order</p>
            <ul className="mb-2 space-y-0.5 text-xs text-muted-foreground">
              {suggestion.parsedItems.map((it, idx) => (
                <li key={idx}>
                  {it.quantity} × {it.name}
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              className="h-8 w-full"
              onClick={() => onCreateDraftOrder(suggestion.id)}
              disabled={busy}
              data-testid="whatsapp-create-draft-order"
            >
              <ShoppingCart className="mr-1 h-3.5 w-3.5" /> Create draft order
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 px-4 py-3">
        <div className="space-y-2">
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex", m.direction === "outbound" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                  m.direction === "outbound"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
                data-testid={`whatsapp-message-${m.id}`}
              >
                <p className="whitespace-pre-wrap break-words">{m.body || `[${m.messageType}]`}</p>
                <p className="mt-1 text-right text-[10px] opacity-70">
                  {formatTime(m.createdAt)}
                  {m.direction === "outbound" ? ` · ${m.status}` : ""}
                </p>
              </div>
            </div>
          ))}
          {messages.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">No messages yet.</p>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-3">
        {!withinServiceWindow ? (
          <div className="space-y-2">
            <p
              className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground"
              data-testid="whatsapp-window-closed"
            >
              This conversation is outside WhatsApp's customer service window. Use an approved template.
            </p>
            <TemplateComposer
              templates={templates}
              canSend={canSend}
              sending={sendingTemplate}
              onSend={onSendTemplate}
            />
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <Textarea
              value={reply}
              onChange={(e) => onReply(e.target.value)}
              placeholder={canSend ? "Type a reply…" : "WhatsApp sending is not configured"}
              rows={2}
              disabled={!canSend || sending}
              className="min-h-[44px] resize-none"
              data-testid="whatsapp-reply-input"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend && !sending && reply.trim()) onSend();
                }
              }}
            />
            <Button
              type="button"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={onSend}
              disabled={!canSend || sending || !reply.trim()}
              aria-label="Send reply"
              data-testid="whatsapp-send"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function TemplateComposer({
  templates,
  canSend,
  sending,
  onSend,
}: {
  templates: Template[];
  canSend: boolean;
  sending: boolean;
  onSend: (vars: { templateName: string; language: string; bodyParams: string[] }) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [params, setParams] = useState<string[]>([]);
  const template = templates.find((t) => t.id === selected);

  const onSelect = (id: string) => {
    setSelected(id);
    const t = templates.find((x) => x.id === id);
    setParams(t ? t.variables.map(() => "") : []);
  };

  if (templates.length === 0) {
    return <p className="text-xs text-muted-foreground">No templates available. Sync them in Settings → Integrations.</p>;
  }

  return (
    <div className="space-y-2" data-testid="whatsapp-template-composer">
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        aria-label="Choose a template"
        data-testid="whatsapp-template-select"
      >
        <option value="">Choose a template…</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.templateName} ({t.status})
          </option>
        ))}
      </select>
      {template && (
        <>
          {template.body && <p className="text-xs text-muted-foreground">{template.body}</p>}
          {template.variables.map((v, idx) => (
            <Input
              key={v + idx}
              value={params[idx] ?? ""}
              onChange={(e) => {
                const next = [...params];
                next[idx] = e.target.value;
                setParams(next);
              }}
              placeholder={`Value for ${v}`}
              className="h-8"
            />
          ))}
          <Button
            size="sm"
            className="w-full"
            disabled={!canSend || sending}
            onClick={() =>
              onSend({
                templateName: template.templateName,
                language: template.language,
                bodyParams: params,
              })
            }
            data-testid="whatsapp-send-template"
          >
            Send template
          </Button>
        </>
      )}
    </div>
  );
}

function LinkCustomerPicker({ onPick }: { onPick: (customerId: string) => void }) {
  const [q, setQ] = useState("");
  const { data: customers = [] } = useQuery<CustomerLite[]>({ queryKey: ["/api/customers"] });
  const filtered = customers
    .filter((c) =>
      q.trim()
        ? c.name.toLowerCase().includes(q.toLowerCase()) || (c.phone ?? "").includes(q)
        : true,
    )
    .slice(0, 6);
  return (
    <div className="rounded-md border border-border p-2" data-testid="whatsapp-link-picker">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search customers…"
        className="mb-2 h-8"
      />
      <ul className="max-h-40 space-y-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <li className="px-1 py-1 text-xs text-muted-foreground">No matches</li>
        ) : (
          filtered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => onPick(c.id)}
              >
                {c.name}
                {c.phone ? <span className="text-xs text-muted-foreground"> · {c.phone}</span> : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
