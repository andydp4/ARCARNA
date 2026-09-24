/**
 * Ask arcarna's engine (v1.2) against a mocked SDK client: the real API is
 * never called from a test.
 *
 * Covers the request the engine builds (model, adaptive thinking, effort,
 * server-side fallbacks, the cached frozen prefix, today's date only in the
 * user turn), the tool loop (every result in one message, the session's role
 * handed to the tools, Evidence links), stop_reason handling (a refusal throws
 * away what was shown and runs no tools; a truncated tool call is never run),
 * usage summed across attempts, the typed SDK errors mapped to a friendly
 * line, and the not-configured switch.
 */
import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AskStreamEvent } from "@shared/ask";

const executeAskTool = vi.fn();
vi.mock("../ask/tools", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  return { ...real, executeAskTool: (...args: unknown[]) => executeAskTool(...args) };
});

const engine = await import("../ask/engine");
const { ASK_TOOLS } = await import("../ask/tools");

type Script = {
  text?: string[];
  content?: any[];
  stop_reason: string;
  usage?: Record<string, unknown>;
  throws?: unknown;
};

function message(s: Script) {
  const content = s.content ?? (s.text ? [{ type: "text", text: s.text.join("") }] : []);
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content,
    stop_reason: s.stop_reason,
    stop_details: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 10,
      iterations: null,
      ...(s.usage ?? {}),
    },
  };
}

function fakeClient(scripts: Script[]) {
  const calls: any[] = [];
  const stream = vi.fn((params: any, opts: any) => {
    calls.push({ params: structuredClone(params), opts });
    const s = scripts.shift();
    if (!s) throw new Error("no more scripted turns");
    return {
      async *[Symbol.asyncIterator]() {
        for (const t of s.text ?? []) yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } };
        if (s.throws) throw s.throws;
      },
      async finalMessage() {
        if (s.throws) throw s.throws;
        return message(s);
      },
    };
  });
  return { client: { beta: { messages: { stream } } } as any, calls, stream };
}

const ctx = { orgId: "org-1", userId: "user-sam", role: "CASHIER", locationId: null };
const config = { apiKey: "sk-test", model: "claude-opus-5", effort: "medium" as const };

async function ask(scripts: Script[], question = "How am I doing?") {
  const fake = fakeClient(scripts);
  const events: AskStreamEvent[] = [];
  const result = await engine.askArcarna({
    client: fake.client,
    config,
    ctx,
    question,
    history: [
      { role: "user", text: "earlier question" },
      { role: "assistant", text: "earlier answer" },
    ],
    contextNote: engine.askContextNote({ role: "CASHIER", todayIso: "2026-09-24", todayLong: "Thursday 24 September 2026", timeZone: "Europe/London" }),
    onEvent: (e) => events.push(e),
  });
  return { ...fake, events, result, text: events.filter((e) => e.type === "text").map((e: any) => e.text).join("") };
}

beforeEach(() => {
  executeAskTool.mockReset();
});

describe("Ask arcarna engine: the request", () => {
  it("builds the documented request: model, adaptive thinking, effort, fallbacks, cached frozen prefix", async () => {
    const { calls, text, result } = await ask([{ text: ["You completed ", "12 orders."], stop_reason: "end_turn" }]);
    expect(text).toBe("You completed 12 orders.");
    expect(result.outcome).toBe("answered");
    const p = calls[0].params;
    expect(p.model).toBe("claude-opus-5");
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.output_config).toEqual({ effort: "medium" });
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(p.fallbacks).toBe("default");
    expect(p.system).toEqual([{ type: "text", text: engine.ASK_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
    // The frozen prefix carries no date or role: those are in the user turn.
    expect(engine.ASK_SYSTEM_PROMPT).not.toMatch(/2026|CASHIER|cashier\b/);
    const last = p.messages[p.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content[0].text).toMatch(/Thursday 24 September 2026.*a cashier/);
    expect(last.content[1].text).toBe("How am I doing?");
    expect(p.messages.slice(0, 2)).toEqual([
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    ]);
    // Deterministic tool list, same for every role, streamed inputs.
    expect(p.tools).toEqual(ASK_TOOLS);
    expect(p.tools.every((t: any) => t.eager_input_streaming === true)).toBe(true);
    expect(p.tools.map((t: any) => t.name)).toEqual([
      "list_evidence",
      "run_evidence",
      "my_performance",
      "staff_performance",
      "needs_a_look",
      "price_overrides",
      "would_have_flagged",
      "stock_levels",
      "staff_targets",
    ]);
  });

  it("reads the model and effort from the environment; no key means off", () => {
    expect(engine.askConfig({} as any)).toEqual({ apiKey: null, model: "claude-opus-5", effort: "medium" });
    expect(engine.isAskConfigured({} as any)).toBe(false);
    expect(engine.isAskConfigured({ ANTHROPIC_API_KEY: "  " } as any)).toBe(false);
    expect(engine.askConfig({ ANTHROPIC_API_KEY: "k", ARCARNA_AI_MODEL: "claude-opus-4-8", ARCARNA_AI_EFFORT: "HIGH" } as any)).toEqual({
      apiKey: "k",
      model: "claude-opus-4-8",
      effort: "high",
    });
    expect(engine.askConfig({ ARCARNA_AI_EFFORT: "max" } as any).effort).toBe("medium");
  });
});

describe("Ask arcarna engine: tools", () => {
  it("runs every tool call of a round with the session's context and sends all results in one message", async () => {
    executeAskTool.mockImplementation(async (name: string) => ({
      content: JSON.stringify({ ok: name }),
      audit: name === "run_evidence" ? "run_evidence:ARC-T1-001" : name,
      status: "Reading",
      evidence: { key: name, title: `Page ${name}`, route: `/${name}` },
    }));
    const { calls, events, result, text } = await ask([
      {
        text: ["Let me look."],
        content: [
          { type: "text", text: "Let me look." },
          { type: "tool_use", id: "tu_1", name: "my_performance", input: { from: "2026-09-21" } },
          { type: "tool_use", id: "tu_2", name: "stock_levels", input: {} },
        ],
        stop_reason: "tool_use",
      },
      { text: ["You did well."], stop_reason: "end_turn" },
    ]);
    expect(executeAskTool).toHaveBeenCalledTimes(2);
    expect(executeAskTool.mock.calls[0]).toEqual(["my_performance", { from: "2026-09-21" }, ctx]);
    const second = calls[1].params.messages;
    const toolMsg = second[second.length - 1];
    expect(toolMsg.role).toBe("user");
    expect(toolMsg.content.map((b: any) => b.tool_use_id)).toEqual(["tu_1", "tu_2"]);
    expect(second[second.length - 2].role).toBe("assistant");
    expect(text).toBe("Let me look.\n\nYou did well.");
    expect(result.tools).toEqual(["my_performance", "stock_levels"]);
    expect(result.evidence.map((e) => e.route)).toEqual(["/my_performance", "/stock_levels"]);
    expect(events.some((e) => e.type === "status")).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: "done", outcome: "answered" });
    // Usage from both rounds.
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 40, cacheReadTokens: 100, cacheWriteTokens: 20 });
  });

  it("a tool error goes back as is_error, and the answer carries on", async () => {
    executeAskTool.mockResolvedValue({ content: '{"error":"x"}', isError: true, audit: "stock_levels", status: "Reading" });
    const { calls, result } = await ask([
      { content: [{ type: "tool_use", id: "tu_1", name: "stock_levels", input: {} }], stop_reason: "tool_use" },
      { text: ["I could not read stock just now."], stop_reason: "end_turn" },
    ]);
    const msgs = calls[1].params.messages;
    expect(msgs[msgs.length - 1].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu_1", is_error: true });
    expect(result.outcome).toBe("answered");
  });

  it("never runs a tool call cut off at max_tokens", async () => {
    const { result, stream } = await ask([
      { content: [{ type: "tool_use", id: "tu_1", name: "stock_levels", input: {} }], stop_reason: "max_tokens" },
    ]);
    expect(executeAskTool).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("cut_short");
  });

  it("stops after the round limit and says so", async () => {
    executeAskTool.mockResolvedValue({ content: "{}", audit: "list_evidence", status: "Reading" });
    const rounds = Array.from({ length: engine.ASK_MAX_ROUNDS }, (_, i) => ({
      content: [{ type: "tool_use", id: `tu_${i}`, name: "list_evidence", input: {} }],
      stop_reason: "tool_use",
    }));
    const { result, text } = await ask(rounds);
    expect(result.outcome).toBe("cut_short");
    expect(text).toMatch(/narrower question/);
  });
});

describe("Ask arcarna engine: stop_reason and refusals", () => {
  it("a refusal throws away what was shown, runs no tools and says so plainly", async () => {
    const { events, result } = await ask([
      {
        text: ["Partial answer that must go"],
        content: [
          { type: "text", text: "Partial answer that must go" },
          { type: "tool_use", id: "tu_1", name: "stock_levels", input: {} },
        ],
        stop_reason: "refusal",
      },
    ]);
    expect(executeAskTool).not.toHaveBeenCalled();
    const discardAt = events.findIndex((e) => e.type === "discard");
    expect(discardAt).toBeGreaterThan(0);
    const after = events.slice(discardAt + 1).filter((e) => e.type === "text").map((e: any) => e.text).join("");
    expect(after).toMatch(/can't help with that one/);
    expect(after).not.toMatch(/Partial answer/);
    expect(result.outcome).toBe("refused");
  });

  it("records a fallback and counts every attempt's tokens", async () => {
    const { result } = await ask([
      {
        text: ["Answer from the fallback."],
        content: [
          { type: "fallback", from: { model: "claude-opus-5" }, to: { model: "claude-opus-4-8" }, trigger: { type: "refusal" } },
          { type: "text", text: "Answer from the fallback." },
        ],
        stop_reason: "end_turn",
        usage: {
          iterations: [
            { type: "message", input_tokens: 300, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            { type: "fallback_message", input_tokens: 300, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          ],
        },
      },
    ]);
    expect(result.servedByFallback).toBe(true);
    expect(result.usage).toEqual({ inputTokens: 600, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it("echoes only text from before a fallback marker", () => {
    const out = engine.assistantTurnForEcho([
      { type: "thinking", thinking: "", signature: "s" },
      { type: "text", text: "partial" },
      { type: "tool_use", id: "x", name: "stock_levels", input: {} },
      { type: "fallback", from: { model: "a" }, to: { model: "b" } },
      { type: "thinking", thinking: "", signature: "t" },
      { type: "tool_use", id: "y", name: "stock_levels", input: {} },
    ] as any);
    expect(out.map((b: any) => b.type)).toEqual(["text", "fallback", "thinking", "tool_use"]);
  });
});

describe("Ask arcarna engine: errors", () => {
  const headers = new Headers();
  const cases: Array<[string, unknown, string]> = [
    ["RateLimitError", new Anthropic.RateLimitError(429, { type: "error" }, "rate limited: secret detail", headers), "ASK_BUSY"],
    ["AuthenticationError", new Anthropic.AuthenticationError(401, { type: "error" }, "invalid x-api-key sk-ant-secret", headers), "ASK_NOT_SET_UP"],
    ["InternalServerError", new Anthropic.InternalServerError(529, { type: "error" }, "overloaded", headers), "ASK_BUSY"],
    ["BadRequestError", new Anthropic.BadRequestError(400, { type: "error" }, "messages.0: bad", headers), "ASK_FAILED"],
    ["APIConnectionError", new Anthropic.APIConnectionError({ message: "ECONNRESET" }), "ASK_UNREACHABLE"],
  ];

  it.each(cases)("%s becomes a friendly line with no detail", async (_name, error, code) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { events, result } = await ask([{ text: ["half"], stop_reason: "end_turn", throws: error }]);
    const err = events.find((e) => e.type === "error") as any;
    expect(err.code).toBe(code);
    expect(err.message).not.toMatch(/secret|sk-ant|messages\.0|ECONNRESET|at \w+ \(/);
    expect(result.outcome).toBe("error");
    // The log line has the class and status, never the message.
    for (const call of spy.mock.calls) expect(String(call.join(" "))).not.toMatch(/secret|sk-ant/);
    spy.mockRestore();
  });

  it("a stop from the person is recorded as stopped, not an error", async () => {
    const { result } = await ask([{ stop_reason: "end_turn", throws: new Anthropic.APIUserAbortError() }]);
    expect(result.outcome).toBe("stopped");
  });

  it("an unparseable streamed tool input re-issues the round, at most twice", async () => {
    const bad = new Error("Unexpected token in JSON");
    const { result, stream, events } = await ask([
      { text: ["Checking"], stop_reason: "tool_use", throws: bad },
      { text: ["Fine now."], stop_reason: "end_turn" },
    ]);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(events.some((e) => e.type === "discard")).toBe(true);
    expect(result.outcome).toBe("answered");
  });
});
