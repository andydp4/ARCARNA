import { z } from "zod";
import type { Role } from "./rbac";
import { isAtLeast } from "./accessPolicy";
import { scrubContactDetails } from "./scrubContact";

/**
 * Ask arcarna (v1.2): staff ask a question in plain English and get an answer
 * from the shop's own Evidence, read-only and only inside their role. Shared
 * by the server (route, engine, tools) and the app (panel, settings card), so
 * the limits and the stream's event shapes cannot drift apart.
 */

/** Every member of staff may ask; each tool then checks the asker's role again. */
export const ASK_MIN_ROLE: Role = "CASHIER";
/** The settings card, the spend cap and the question log: admins and the owner. */
export const ASK_ADMIN_MIN_ROLE: Role = "ADMIN";

/** The model when ARCARNA_AI_MODEL is not set. Exact ID, no date suffix. */
export const ASK_DEFAULT_MODEL = "claude-opus-5";
export const ASK_EFFORTS = ["low", "medium", "high"] as const;
export type AskEffort = (typeof ASK_EFFORTS)[number];
/** Routine questions: medium thinking effort unless ARCARNA_AI_EFFORT says otherwise. */
export const ASK_DEFAULT_EFFORT: AskEffort = "medium";

/**
 * Published claude-opus-5 prices in US dollars per million tokens: $5 in,
 * $25 out. A cache write bills 1.25x the input price and a cache read 0.1x.
 */
export const ASK_PRICE_USD_PER_MTOK = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 } as const;

export const ASK_DEFAULT_SETTINGS = { monthlyCapGbp: 25, usdToGbp: 0.79 } as const;

export const ASK_QUESTION_MAX = 1000;
/** The conversation kept on the device: at most ten question-and-answer turns. */
export const ASK_HISTORY_TURNS = 10;
export const ASK_HISTORY_TEXT_MAX = 4000;

/** Per person: this many questions in the window, then a short wait. */
export const ASK_RATE_LIMIT = { max: 10, windowMs: 10 * 60_000 } as const;

export const askTurnSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    text: z.string().max(ASK_HISTORY_TEXT_MAX),
  })
  .strict();
export type AskTurn = z.infer<typeof askTurnSchema>;

export const askRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(ASK_QUESTION_MAX),
    history: z.array(askTurnSchema).max(ASK_HISTORY_TURNS * 2).default([]),
  })
  .strict();
export type AskRequest = z.infer<typeof askRequestSchema>;

export const askSettingsSchema = z
  .object({
    monthlyCapGbp: z.number().finite().min(0).max(10_000),
    usdToGbp: z.number().finite().min(0.1).max(5),
  })
  .strict();
export type AskSettingsInput = z.infer<typeof askSettingsSchema>;

/**
 * The history as the API wants it: starting with a question, alternating,
 * ending with an answer (the new question comes after), no empty turns, the
 * last ASK_HISTORY_TURNS pairs. The device keeps it, so it is only ever text;
 * whatever it claims, the tools still check the asker's real role.
 */
export function normaliseHistory(history: readonly AskTurn[]): AskTurn[] {
  const out: AskTurn[] = [];
  for (const turn of history) {
    const text = turn.text.trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (!last && turn.role !== "user") continue;
    if (last && last.role === turn.role) {
      last.text = `${last.text}\n\n${text}`.slice(0, ASK_HISTORY_TEXT_MAX);
      continue;
    }
    out.push({ role: turn.role, text });
  }
  if (out.length && out[out.length - 1].role === "user") out.pop();
  return out.slice(-ASK_HISTORY_TURNS * 2);
}

export interface AskUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function emptyAskUsage(): AskUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

/** Estimated cost in pounds, from the published dollar price and the org's rate. Four decimals. */
export function estimateCostGbp(usage: AskUsage, usdToGbp: number): number {
  const p = ASK_PRICE_USD_PER_MTOK;
  const usd =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheWriteTokens * p.cacheWrite +
      usage.cacheReadTokens * p.cacheRead) /
    1_000_000;
  return Math.round(usd * usdToGbp * 10_000) / 10_000;
}

/** The question as kept for admins: contact and card details taken out first. */
export function scrubQuestion(question: string): { text: string; scrubbed: boolean } {
  const text = scrubContactDetails(question).slice(0, ASK_QUESTION_MAX);
  return { text, scrubbed: text !== question.slice(0, ASK_QUESTION_MAX) };
}

/** Suggested questions, per role: each can be answered by that role's tools. */
export function askSuggestionsFor(role: string | null | undefined): string[] {
  if (isAtLeast(role, "ADMIN")) {
    return [
      "How did we do last Saturday vs the one before?",
      "Which products sold below their minimum price this week?",
      "Who has the most unreviewed flags in Needs a look?",
      "What would the price guard have flagged in the last two weeks?",
    ];
  }
  if (isAtLeast(role, "MANAGER")) {
    return [
      "How did we do last Saturday vs the one before?",
      "Which products sold below their minimum price this week?",
      "Who has the most unreviewed flags in Needs a look?",
      "Which products are running low?",
    ];
  }
  return [
    "How am I doing this week?",
    "What are my targets?",
    "Which products are out of stock?",
    "Which products are running low?",
  ];
}

/** The note under every answer. */
export const ASK_ANSWER_NOTE = "Answers come from arcarna's Evidence. Check important figures before acting on them.";

/** A page an answer was built from, linked under the answer. */
export interface AskEvidenceLink {
  key: string;
  title: string;
  route: string;
}

/**
 * The stream the app reads (server-sent events on the POST's response):
 *  text      a piece of the answer as it is written
 *  status    what arcarna is looking at now ("Reading Weekly Sales Summary")
 *  evidence  the pages used so far
 *  discard   throw away the answer shown so far (a refusal mid-answer)
 *  done      finished; outcome says how
 *  error     a friendly message; nothing technical
 */
export type AskOutcome = "answered" | "refused" | "cut_short" | "error" | "stopped";
export type AskStreamEvent =
  | { type: "text"; text: string }
  | { type: "status"; text: string }
  | { type: "evidence"; items: AskEvidenceLink[] }
  | { type: "discard" }
  | { type: "done"; outcome: AskOutcome; evidence: AskEvidenceLink[] }
  | { type: "error"; message: string; code?: string };

export interface AskStatus {
  enabled: boolean;
  suggestions: string[];
  note: string;
}

export interface AskSettingsView {
  configured: boolean;
  model: string;
  effort: AskEffort;
  monthlyCapGbp: number;
  usdToGbp: number;
  spentThisMonthGbp: number;
  questionsThisMonth: number;
  monthStart: string;
  envLines: string[];
  pricePerMTokUsd: { input: number; output: number };
}

export interface AskLogRow {
  id: string;
  askedAt: string;
  userId: string;
  name: string;
  role: string;
  question: string;
  questionScrubbed: boolean;
  tools: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costGbp: number;
  outcome: AskOutcome;
  servedByFallback: boolean;
}
