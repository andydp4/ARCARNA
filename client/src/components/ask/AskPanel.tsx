import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Link } from "wouter";
import { FileBarChart, Loader2, Mic, MicOff, MessageCircleQuestion, Send, Square } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { AskError, OPEN_ASK_EVENT, openAskPanel, streamAsk } from "@/lib/ask";
import { getSpeechProvider } from "@/lib/speech";
import { stashWhatsappDraft } from "@/lib/whatsappDraft";
import { isAtLeast } from "@shared/accessPolicy";
import {
  ASK_ANSWER_NOTE,
  ASK_HISTORY_TURNS,
  ASK_QUESTION_MAX,
  type AskEvidenceLink,
  type AskOutcome,
  type AskStatus,
  type AskTillDraft,
  type AskTurn,
} from "@shared/ask";

/** Whether Ask arcarna is on for this shop; off (and hidden) until an admin sets it up. */
export function useAskStatus() {
  const { user } = useAuth();
  const isStaff = isAtLeast(user?.role ?? null, "CASHIER");
  return useQuery<AskStatus>({ queryKey: ["/api/ask/status"], enabled: isStaff, staleTime: 5 * 60_000 });
}

/**
 * The header button. Icon-only below sm with an aria-label: the phone header
 * was just made to fit 412px, and a word here would push it wider again.
 */
export function AskButton({ className }: { className?: string }) {
  const { data } = useAskStatus();
  if (!data?.enabled) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => openAskPanel()}
      className={cn("min-h-[44px] min-w-[44px] gap-1.5 px-2 sm:px-3", className)}
      aria-label="Ask arcarna"
      title="Ask arcarna"
      data-testid="button-ask-arcarna"
    >
      <MessageCircleQuestion className="h-5 w-5" aria-hidden />
      <span className="hidden lg:inline">Ask arcarna</span>
    </Button>
  );
}

interface Exchange {
  id: number;
  question: string;
  answer: string;
  status: string | null;
  evidence: AskEvidenceLink[];
  outcome: AskOutcome | null;
  error: string | null;
  pending: boolean;
}

/** The conversation as the server takes it: finished, answered turns only, the last ten. */
function historyOf(exchanges: Exchange[]): AskTurn[] {
  const turns: AskTurn[] = [];
  for (const e of exchanges) {
    if (e.pending || e.outcome !== "answered" || !e.answer.trim()) continue;
    turns.push({ role: "user", text: e.question.slice(0, 4000) }, { role: "assistant", text: e.answer.slice(0, 4000) });
  }
  return turns.slice(-ASK_HISTORY_TURNS * 2);
}

/**
 * Ask arcarna (v1.2): mounted once in the Layout, opened by the header button
 * or the Truths Centre. The conversation lives here, on this device, and is
 * gone when the page reloads; the server keeps only the audit row.
 */
export function AskPanel() {
  const { data: status } = useAskStatus();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [listening, setListening] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement | null>(null);
  const busy = exchanges.some((e) => e.pending);
  const speech = getSpeechProvider();

  const openTillDraft = useCallback(
    (tillDraft: AskTillDraft) => {
      stashWhatsappDraft({
        conversationId: "",
        source: "voice",
        customerId: tillDraft.customerId,
        customerName: tillDraft.customerName,
        note: tillDraft.note,
        items: tillDraft.items,
      });
      setOpen(false);
      navigate("/create-order");
      if (speech.isSupported()) speech.speak("Opening it in the till.").catch(() => {});
    },
    [navigate, speech],
  );

  const update = useCallback((id: number, change: (e: Exchange) => Exchange) => {
    setExchanges((list) => list.map((e) => (e.id === id ? change(e) : e)));
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      const id = nextId.current++;
      const history = historyOf(exchanges);
      setExchanges((list) => [
        ...list,
        { id, question: q, answer: "", status: "Thinking", evidence: [], outcome: null, error: null, pending: true },
      ]);
      setDraft("");
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamAsk(
          q,
          history,
          (event) => {
            switch (event.type) {
              case "text":
                update(id, (e) => ({ ...e, answer: e.answer + event.text, status: null }));
                break;
              case "status":
                update(id, (e) => ({ ...e, status: event.text }));
                break;
              case "evidence":
                update(id, (e) => ({ ...e, evidence: event.items }));
                break;
              case "discard":
                update(id, (e) => ({ ...e, answer: "" }));
                break;
              case "till_draft":
                openTillDraft(event.draft);
                break;
              case "done":
                update(id, (e) => ({ ...e, evidence: event.evidence, outcome: event.outcome, pending: false, status: null }));
                break;
              case "error":
                update(id, (e) => ({ ...e, error: event.message, outcome: "error", pending: false, status: null }));
                break;
            }
          },
          controller.signal,
        );
        update(id, (e) => (e.pending ? { ...e, pending: false, status: null, outcome: e.outcome ?? "answered" } : e));
      } catch (error) {
        const stopped = controller.signal.aborted;
        update(id, (e) => ({
          ...e,
          pending: false,
          status: null,
          outcome: stopped ? "stopped" : "error",
          error: stopped ? null : error instanceof AskError ? error.message : "Ask arcarna could not answer just now.",
        }));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [busy, exchanges, update, openTillDraft],
  );

  const handleMic = useCallback(async () => {
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
      await ask(transcript);
    } catch (e: any) {
      toast({ title: "Couldn't hear that", description: e?.message || "Speech recognition failed." });
    } finally {
      setListening(false);
    }
  }, [ask, listening, speech, toast]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      setOpen(true);
      const question = (event as CustomEvent<{ question: string | null }>).detail?.question;
      if (question) setDraft(question);
    };
    window.addEventListener(OPEN_ASK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ASK_EVENT, onOpen);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [exchanges]);

  // Stop paying for an answer nobody is reading.
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  if (!status?.enabled) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg" data-testid="ask-panel">
        <div className="border-b border-border p-4 pr-12">
          <SheetTitle className="flex items-center gap-2">
            <MessageCircleQuestion className="h-5 w-5" aria-hidden />
            Ask arcarna
          </SheetTitle>
          <SheetDescription className="mt-1 text-xs">{status.note ?? ASK_ANSWER_NOTE}</SheetDescription>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite" data-testid="ask-conversation">
          {exchanges.length === 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Ask about your shop in plain English. Try:</p>
              <div className="flex flex-col gap-2">
                {status.suggestions.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant="outline"
                    className="h-auto min-h-[44px] justify-start whitespace-normal text-left"
                    onClick={() => void ask(s)}
                    data-testid="ask-suggestion"
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {exchanges.map((e) => (
            <div key={e.id} className="space-y-2">
              <p className="ml-auto w-fit max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-sm">{e.question}</p>
              <div className="space-y-2 rounded-lg border border-border p-3 text-sm" data-testid="ask-answer">
                {e.answer && <p className="whitespace-pre-wrap">{e.answer}</p>}
                {e.pending && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    {e.status ?? "Writing"}…
                  </p>
                )}
                {e.error && (
                  <p className="text-destructive" role="alert">
                    {e.error}
                  </p>
                )}
                {e.outcome === "stopped" && !e.error && <p className="text-muted-foreground">Stopped.</p>}
                {e.evidence.length > 0 && (
                  <div className="border-t border-border pt-2">
                    <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">From</p>
                    <ul className="flex flex-wrap gap-2">
                      {e.evidence.map((link) => (
                        <li key={link.key}>
                          <Link
                            href={link.route}
                            onClick={() => setOpen(false)}
                            className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-border px-2 text-xs underline-offset-2 hover:underline"
                            data-testid="ask-evidence-link"
                          >
                            <FileBarChart className="h-3.5 w-3.5" aria-hidden />
                            {link.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!e.pending && e.outcome === "answered" && (
                  <p className="text-xs text-muted-foreground">{ASK_ANSWER_NOTE}</p>
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <form onSubmit={submit} className="flex items-end gap-2 border-t border-border p-3">
          <label htmlFor="ask-question" className="sr-only">
            Your question
          </label>
          <Textarea
            id="ask-question"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, ASK_QUESTION_MAX))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(draft);
              }
            }}
            placeholder="e.g. How did we do last Saturday?"
            rows={2}
            className="min-h-[44px] flex-1 resize-none"
            data-testid="ask-input"
          />
          {speech.isSupported() && (
            <Button
              type="button"
              variant={listening ? "destructive" : "outline"}
              className="min-h-[44px]"
              onClick={handleMic}
              disabled={busy}
              aria-label={listening ? "Stop listening" : "Speak to arcarna"}
              data-testid="ask-mic"
            >
              {listening ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
            </Button>
          )}
          {busy ? (
            <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => abortRef.current?.abort()} aria-label="Stop">
              <Square className="h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <Button type="submit" className="min-h-[44px]" disabled={!draft.trim()} aria-label="Ask" data-testid="ask-send">
              <Send className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}
