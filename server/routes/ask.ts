import type { Express, RequestHandler } from "express";
import { requireRole } from "../auth";
import { rolesAtLeast } from "@shared/accessPolicy";
import {
  ASK_ADMIN_MIN_ROLE,
  ASK_ANSWER_NOTE,
  ASK_MIN_ROLE,
  ASK_PRICE_USD_PER_MTOK,
  ASK_RATE_LIMIT,
  askRequestSchema,
  askSettingsSchema,
  askSuggestionsFor,
  normaliseHistory,
  type AskSettingsView,
  type AskStatus,
  type AskStreamEvent,
} from "@shared/ask";
import { currentTradingDay } from "@shared/time/tradingDay";
import { recordAdminAudit } from "../adminAudit";
import { perPersonRateLimit } from "../lib/perPersonRateLimit";
import { sendServerError } from "../lib/errorScrub";
import { askArcarna, askConfig, askContextNote, createAskClient } from "../ask/engine";

/** One per process, like the other per-person limits (opsBus.ts). Exported so tests can reset it. */
export const askRateLimit = perPersonRateLimit({
  windowMs: ASK_RATE_LIMIT.windowMs,
  max: ASK_RATE_LIMIT.max,
  name: "ask",
  message: "You've asked a lot of questions in the last few minutes. Wait a little and try again.",
});

export const ASK_ENV_LINES = [
  "ANTHROPIC_API_KEY=sk-ant-...",
  "# Optional: ARCARNA_AI_MODEL=claude-opus-5",
  "# Optional: ARCARNA_AI_EFFORT=medium",
];

const NOT_SET_UP = "Ask arcarna is not set up. An admin can switch it on in Settings › Integrations.";

/**
 * Ask arcarna (v1.2).
 *
 *  - GET  /api/ask/status    every member of staff: whether it is on, and the
 *                            suggested questions for their role. Off (and the
 *                            panel hidden) when ANTHROPIC_API_KEY is not set.
 *  - POST /api/ask           every member of staff: one question, answered as
 *                            a stream of server-sent events. Per-person rate
 *                            limit and the org's monthly spend cap first.
 *  - GET/PUT /api/ask/settings  admins and the owner: the spend cap and the
 *                            dollar-to-pound rate; every change logged.
 *  - GET  /api/ask/log       admins and the owner: who asked what (scrubbed),
 *                            when, which tools ran, tokens and cost.
 *
 * The role that counts is the session's; each tool checks it again.
 */
export function registerAskRoutes(app: Express, scoped: RequestHandler[]): void {
  const staff = requireRole(...rolesAtLeast(ASK_MIN_ROLE));
  const admins = requireRole(...rolesAtLeast(ASK_ADMIN_MIN_ROLE));
  const viewerOf = (req: any) => ({
    userId: String(req.user?.id ?? ""),
    role: String(req.orgContext?.role ?? req.user?.role ?? ""),
  });

  app.get("/api/ask/status", ...scoped, staff, (req: any, res) => {
    const enabled = askConfig().apiKey !== null;
    const body: AskStatus = { enabled, suggestions: enabled ? askSuggestionsFor(viewerOf(req).role) : [], note: ASK_ANSWER_NOTE };
    res.json(body);
  });

  app.post("/api/ask", ...scoped, staff, async (req: any, res, next) => {
    const config = askConfig();
    if (!config.apiKey) return res.status(503).json({ message: NOT_SET_UP, code: "ASK_NOT_SET_UP" });
    const parsed = askRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Type a question (up to 1,000 characters).", code: "ASK_BAD_REQUEST" });
    }
    askRateLimit(req, res, () => void answer(req, res, config, parsed.data).catch(next));
  });

  async function answer(req: any, res: any, config: ReturnType<typeof askConfig>, body: { question: string; history: any[] }) {
    const orgId = req.orgContext.orgId as string;
    const viewer = viewerOf(req);
    const { getAskSettings, askSpendThisMonth, recordAskQuestion } = await import("../ask/store");
    const { orgTimeZone } = await import("../services/tradingDayShift");
    let settings;
    let timeZone: string;
    try {
      settings = await getAskSettings(orgId);
      const spend = await askSpendThisMonth(orgId);
      if (settings.monthlyCapGbp <= 0 || spend.spentGbp >= settings.monthlyCapGbp) {
        return res.status(429).json({
          message: "Ask arcarna has reached this month's spending limit. An admin can raise it in Settings › Integrations.",
          code: "ASK_SPEND_CAP",
        });
      }
      timeZone = await orgTimeZone(orgId);
    } catch (error) {
      return sendServerError(res, error, "Ask arcarna is not available just now", { log: "[Ask] before answering:" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const controller = new AbortController();
    // The person closed the panel or lost signal: stop paying for an answer nobody reads.
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });
    const send = (event: AskStreamEvent) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.flush?.();
    };

    const now = new Date();
    const todayLong = new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone,
    }).format(now);
    const result = await askArcarna({
      client: createAskClient(config.apiKey!),
      config,
      ctx: { orgId, userId: viewer.userId, role: viewer.role, locationId: req.orgContext.locationId ?? null },
      question: body.question,
      history: normaliseHistory(body.history),
      contextNote: askContextNote({ role: viewer.role, todayIso: currentTradingDay(timeZone, now), todayLong, timeZone }),
      onEvent: send,
      signal: controller.signal,
    });

    try {
      await recordAskQuestion({
        orgId,
        userId: viewer.userId,
        role: viewer.role,
        question: body.question,
        tools: result.tools,
        model: result.model,
        usage: result.usage,
        usdToGbp: settings.usdToGbp,
        outcome: result.outcome,
        servedByFallback: result.servedByFallback,
      });
    } catch (error) {
      console.error("[Ask] could not record the question:", (error as Error)?.name ?? "error");
    }
    if (!res.writableEnded) res.end();
  }

  app.get("/api/ask/settings", ...scoped, admins, async (req: any, res) => {
    try {
      const orgId = req.orgContext.orgId as string;
      const { getAskSettings, askSpendThisMonth } = await import("../ask/store");
      const config = askConfig();
      const [settings, spend] = await Promise.all([getAskSettings(orgId), askSpendThisMonth(orgId)]);
      const body: AskSettingsView = {
        configured: config.apiKey !== null,
        model: config.model,
        effort: config.effort,
        monthlyCapGbp: settings.monthlyCapGbp,
        usdToGbp: settings.usdToGbp,
        spentThisMonthGbp: Math.round(spend.spentGbp * 100) / 100,
        questionsThisMonth: spend.questions,
        monthStart: spend.monthStart,
        envLines: ASK_ENV_LINES,
        pricePerMTokUsd: { input: ASK_PRICE_USD_PER_MTOK.input, output: ASK_PRICE_USD_PER_MTOK.output },
      };
      res.setHeader("Cache-Control", "no-store, private");
      res.json(body);
    } catch (error) {
      sendServerError(res, error, "Failed to load Ask arcarna settings", { log: "[Ask] settings:" });
    }
  });

  app.put("/api/ask/settings", ...scoped, admins, async (req: any, res) => {
    const parsed = askSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Enter a monthly limit in pounds (0 to 10,000) and a dollar-to-pound rate (0.1 to 5)." });
    }
    try {
      const orgId = req.orgContext.orgId as string;
      const viewer = viewerOf(req);
      const { getAskSettings, saveAskSettings } = await import("../ask/store");
      const previous = await getAskSettings(orgId);
      const saved = await saveAskSettings(orgId, parsed.data, viewer.userId || "unknown");
      await recordAdminAudit(req, {
        actorUserId: viewer.userId || "unknown",
        actorRole: viewer.role,
        action: "ask.settings.saved",
        targetType: "organization",
        targetId: orgId,
        orgId,
        metadata: { from: previous, to: saved },
      });
      res.json(saved);
    } catch (error) {
      sendServerError(res, error, "Failed to save Ask arcarna settings", { log: "[Ask] save settings:" });
    }
  });

  app.get("/api/ask/log", ...scoped, admins, async (req: any, res) => {
    try {
      const { listAskLog } = await import("../ask/store");
      res.setHeader("Cache-Control", "no-store, private");
      res.json({ rows: await listAskLog(req.orgContext.orgId as string, 100) });
    } catch (error) {
      sendServerError(res, error, "Failed to load the question log", { log: "[Ask] log:" });
    }
  });
}
