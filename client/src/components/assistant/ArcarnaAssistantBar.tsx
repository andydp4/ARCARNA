import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Mic, MicOff, Send, Volume2, VolumeX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getSpeechProvider } from "@/lib/speech";
import { STORAGE_VOICE_ENABLED } from "@shared/storageKeys";
import { stashWhatsappDraft } from "@/lib/whatsappDraft";

interface QuickEntryTurnResponse {
  action: "ask" | "draft" | "cancel";
  draft: unknown | null;
  message: string;
  voiceResponse: string;
  missingFields: string[];
  /** Set on "draft": what the till opens with (v1.2 Phase 1B). */
  tillDraft?: {
    customerId: string | null;
    customerName: string | null;
    items: Array<{ sku: string; name: string; quantity: number }>;
    note?: string;
  };
}

interface LogEntry {
  from: "user" | "arcarna";
  text: string;
}

/**
 * Arcarna Voice — floating typed/mic command bar driving the QuickEntryEngine.
 * It drafts orders; it never saves one. A confirmed draft opens in the till,
 * which prices it and takes payment (v1.2 Phase 1B, owner Q19).
 */
export function ArcarnaAssistantBar() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [draft, setDraft] = useState<unknown | null>(null);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_VOICE_ENABLED) !== "0";
    } catch {
      return true;
    }
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const speech = getSpeechProvider();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [log]);

  const toggleVoice = () => {
    setVoiceOn((v) => {
      const next = !v;
      try {
        localStorage.setItem(STORAGE_VOICE_ENABLED, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setLog((l) => [...l, { from: "user", text: trimmed }]);
    setInput("");
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/assistant/turn", { text: trimmed, draft });
      const result = (await res.json()) as QuickEntryTurnResponse;
      setDraft(result.draft);
      setLog((l) => [...l, { from: "arcarna", text: result.message }]);
      if (voiceOn && speech.isSupported()) {
        speech.speak(result.voiceResponse).catch(() => {});
      }
      if (result.action === "draft" && result.tillDraft) {
        stashWhatsappDraft({
          conversationId: "",
          source: "voice",
          customerId: result.tillDraft.customerId,
          customerName: result.tillDraft.customerName,
          note: result.tillDraft.note,
          items: result.tillDraft.items.map((i) => ({ sku: i.sku, name: i.name, quantity: i.quantity })),
        });
        setOpen(false);
        navigate("/create-order");
      }
    } catch (e: any) {
      const message = e?.message || "Something went wrong.";
      setLog((l) => [...l, { from: "arcarna", text: message }]);
    } finally {
      setBusy(false);
    }
  }

  async function handleMic() {
    if (!speech.isSupported()) {
      toast({ title: "Voice not supported", description: "Your browser doesn't support speech recognition." });
      return;
    }
    if (listening) {
      speech.stop();
      setListening(false);
      return;
    }
    setListening(true);
    try {
      const transcript = await speech.listen();
      await submit(transcript);
    } catch (e: any) {
      toast({ title: "Couldn't hear that", description: e?.message || "Speech recognition failed." });
    } finally {
      setListening(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // Icon-only on a phone (UI-01): the labelled pill covered the till's
        // Customer select; a 48px circle stacked over the WhatsApp launcher
        // covers as little as it can.
        className="fixed bottom-20 right-5 z-40 h-12 w-12 gap-2 rounded-full p-0 shadow-lg sm:bottom-24 sm:w-auto sm:px-4"
        data-testid="arcarna-voice-launcher"
        aria-label="arcarna Voice"
      >
        <Mic className="h-5 w-5" aria-hidden />
        <span className="hidden sm:inline">Voice</span>
      </Button>

      {open && (
        <div
          className="fixed bottom-40 right-5 z-40 flex w-full max-w-sm flex-col rounded-lg border border-border bg-background shadow-xl"
          data-testid="arcarna-voice-panel"
          role="dialog"
          aria-label="arcarna Voice"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <span className="font-semibold">arcarna Voice</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={toggleVoice}
                aria-label={voiceOn ? "Mute arcarna's voice" : "Enable arcarna's voice"}
                data-testid="arcarna-voice-toggle"
              >
                {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setOpen(false)}
                aria-label="Close arcarna Voice"
                data-testid="arcarna-voice-close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <ScrollArea className="h-64 px-4 py-2">
            {log.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Try "Bunny wants 50 Product 1 tomorrow."
              </p>
            ) : (
              <div className="flex flex-col gap-2 py-2">
                {log.map((entry, i) => (
                  <div
                    key={i}
                    className={
                      entry.from === "user"
                        ? "self-end rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                        : "self-start rounded-lg bg-muted px-3 py-1.5 text-sm"
                    }
                  >
                    {entry.text}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </ScrollArea>

          <form
            className="flex items-center gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <Button
              type="button"
              variant={listening ? "destructive" : "outline"}
              size="sm"
              className="h-9 shrink-0 gap-1"
              onClick={handleMic}
              aria-label={listening ? "Stop listening" : "Speak a command"}
              data-testid="arcarna-voice-mic"
            >
              {listening ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
              {listening ? "Stop" : "Speak"}
            </Button>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a command…"
              disabled={busy}
              data-testid="arcarna-voice-input"
            />
            <Button
              type="submit"
              size="sm"
              aria-label="Send message to the assistant"
              className="h-9 shrink-0 gap-1"
              disabled={busy || !input.trim()}
            >
              <Send className="h-4 w-4" aria-hidden />
              Send
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
