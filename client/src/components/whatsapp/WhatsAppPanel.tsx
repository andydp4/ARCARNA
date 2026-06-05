import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, X, ChevronLeft, Search, Send, User, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiRequest, getJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

interface ConversationDetail {
  conversation: ConversationListItem;
  messages: WhatsappMessage[];
  withinServiceWindow: boolean;
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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const { data: status } = useQuery<WhatsappStatus>({
    queryKey: ["/api/whatsapp/status"],
    refetchInterval: 60000,
  });

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
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations", activeId, "detail"] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations"] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to send message";
      toast({ title: "Could not send", description: message, variant: "destructive" });
    },
  });

  const openConversation = (id: string) => {
    setActiveId(id);
    markRead.mutate(id);
  };

  const unread = status?.unread ?? 0;

  return (
    <>
      {/* Persistent launcher (always available across the app shell). */}
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
          {/* Header */}
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
              reply={reply}
              onReply={setReply}
              onSend={() => reply.trim() && sendReply.mutate(reply.trim())}
              sending={sendReply.isPending}
              canSend={status?.canSend ?? false}
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
  reply,
  onReply,
  onSend,
  sending,
  canSend,
}: {
  detail: ConversationDetail | undefined;
  reply: string;
  onReply: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  canSend: boolean;
}) {
  if (!detail) {
    return <p className="flex-1 p-4 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  const { conversation, messages, withinServiceWindow } = detail;
  return (
    <>
      <div className="border-b border-border px-4 py-3">
        <p className="font-medium">
          {conversation.customerName || conversation.profileName || conversation.phone}
        </p>
        <p className="text-xs text-muted-foreground">+{conversation.waId}</p>
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
                <p className="whitespace-pre-wrap break-words">
                  {m.body || `[${m.messageType}]`}
                </p>
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
          <p
            className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground"
            data-testid="whatsapp-window-closed"
          >
            This conversation is outside WhatsApp's customer service window. Use an approved template.
          </p>
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
