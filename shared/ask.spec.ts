import { describe, expect, it } from "vitest";
import {
  ASK_DEFAULT_MODEL,
  ASK_HISTORY_TURNS,
  askPriceFor,
  askRequestSchema,
  askSettingsSchema,
  askSuggestionsFor,
  estimateCostGbp,
  normaliseHistory,
  scrubQuestion,
} from "./ask";

describe("Ask arcarna: shared rules", () => {
  it("uses the exact model id by default", () => {
    expect(ASK_DEFAULT_MODEL).toBe("claude-opus-5");
  });

  it("prices from the published $5 in / $25 out per million, converted at the org's rate", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    // $30 at 0.8 = £24.
    expect(estimateCostGbp(usage, 0.8)).toBe(24);
    // Cache writes 1.25x input, reads 0.1x input.
    expect(estimateCostGbp({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000, cacheReadTokens: 1_000_000 }, 1)).toBe(6.75);
    expect(estimateCostGbp({ inputTokens: 1234, outputTokens: 567, cacheReadTokens: 0, cacheWriteTokens: 0 }, 0.79)).toBeCloseTo(0.016, 3);
  });

  it("prices the model that ran: an ARCARNA_AI_MODEL override is not priced as claude-opus-5", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(estimateCostGbp(usage, 1, "claude-opus-5")).toBe(30);
    expect(estimateCostGbp(usage, 1, "claude-fable-5-1")).toBe(60);
    expect(estimateCostGbp(usage, 1, "claude-sonnet-5")).toBe(12);
    // A model not in the table is priced at the dearest known rates, never the cheapest.
    expect(askPriceFor("claude-some-future-model")).toEqual({ input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 });
    expect(estimateCostGbp(usage, 1, "claude-some-future-model")).toBe(60);
  });

  it("keeps the history to alternating question-and-answer pairs, oldest dropped", () => {
    const long = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `t${i}` }) as const);
    const out = normaliseHistory(long);
    expect(out.length).toBe(ASK_HISTORY_TURNS * 2);
    expect(out[0].role).toBe("user");
    expect(out[out.length - 1].role).toBe("assistant");
    expect(out[out.length - 1].text).toBe("t29");
  });

  it("drops a leading answer, merges repeats, and drops a trailing question", () => {
    const out = normaliseHistory([
      { role: "assistant", text: "hello" },
      { role: "user", text: "a" },
      { role: "user", text: "b" },
      { role: "assistant", text: "  " },
      { role: "assistant", text: "c" },
      { role: "user", text: "unanswered" },
    ]);
    expect(out).toEqual([
      { role: "user", text: "a\n\nb" },
      { role: "assistant", text: "c" },
    ]);
  });

  it("scrubs phone numbers, emails and postcodes out of a stored question and says so", () => {
    const q = scrubQuestion("What did jane@example.com on 07700 900123 at SW1A 1AA buy?");
    expect(q.text).not.toMatch(/jane@|07700|SW1A/);
    expect(q.scrubbed).toBe(true);
    expect(scrubQuestion("How did we do last Saturday?")).toEqual({ text: "How did we do last Saturday?", scrubbed: false });
  });

  it("refuses an empty or over-long question and unknown fields", () => {
    expect(askRequestSchema.safeParse({ question: "  " }).success).toBe(false);
    expect(askRequestSchema.safeParse({ question: "x".repeat(1001) }).success).toBe(false);
    expect(askRequestSchema.safeParse({ question: "ok", role: "ADMIN" }).success).toBe(false);
    expect(askRequestSchema.safeParse({ question: "ok" }).success).toBe(true);
  });

  it("settings: a cap of 0 or more, a sensible rate", () => {
    expect(askSettingsSchema.safeParse({ monthlyCapGbp: 0, usdToGbp: 0.79 }).success).toBe(true);
    expect(askSettingsSchema.safeParse({ monthlyCapGbp: -1, usdToGbp: 0.79 }).success).toBe(false);
    expect(askSettingsSchema.safeParse({ monthlyCapGbp: 10, usdToGbp: 0 }).success).toBe(false);
  });

  it("suggests only what the role can be answered about", () => {
    const cashier = askSuggestionsFor("CASHIER").join(" ");
    expect(cashier).not.toMatch(/Saturday|flags|minimum/);
    expect(askSuggestionsFor("MANAGER").join(" ")).toMatch(/flags/);
    expect(askSuggestionsFor("ADMIN").join(" ")).toMatch(/price guard/);
  });
});
