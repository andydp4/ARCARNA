import { apiFetch } from "@/lib/appPaths";
import type { AskStreamEvent, AskTurn } from "@shared/ask";

/** Opens the Ask arcarna panel from anywhere (the header, the Truths Centre). */
export const OPEN_ASK_EVENT = "arcarna:open-ask";

export function openAskPanel(question?: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_ASK_EVENT, { detail: { question: question ?? null } }));
}

export class AskError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/**
 * Splits a server-sent-events body into its `data:` payloads. Kept apart from
 * the network so it can be tested on its own; a payload that is not JSON is
 * skipped rather than shown.
 */
export function parseAskEvents(buffer: string): { events: AskStreamEvent[]; rest: string } {
  const events: AskStreamEvent[] = [];
  const chunks = buffer.split("\n\n");
  const rest = chunks.pop() ?? "";
  for (const chunk of chunks) {
    const data = chunk
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as AskStreamEvent);
    } catch {
      /* not an event */
    }
  }
  return { events, rest };
}

/**
 * Asks one question and hands each event to `onEvent` as it arrives, so the
 * answer appears while it is being written. The history is the conversation
 * kept on this device (the server keeps no conversation).
 */
export async function streamAsk(
  question: string,
  history: AskTurn[],
  onEvent: (event: AskStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await apiFetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ question, history }),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = "Ask arcarna could not answer just now.";
    let code: string | undefined;
    try {
      const body = await res.json();
      if (typeof body?.message === "string") message = body.message;
      if (typeof body?.code === "string") code = body.code;
    } catch {
      /* not JSON */
    }
    throw new AskError(res.status, message, code);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseAskEvents(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) onEvent(event);
  }
  buffer += decoder.decode();
  for (const event of parseAskEvents(`${buffer}\n\n`).events) onEvent(event);
}
