import type { Express, RequestHandler } from "express";
import { runAssistantTurn } from "../assistant/engine";
import { getAssistantAlerts, getDailySummary } from "../assistant/alerts";
import type { QuickEntryDraft } from "../assistant/quickEntry";
import { requireRole } from "../auth";
import { EVIDENCE_MIN_ROLE, rolesAtLeast } from "@shared/accessPolicy";
import { sendServerError } from "../lib/errorScrub";

/** The day's summary and alerts read takings and customers: manager and above (PRV-02). */
const evidenceRoles = requireRole(...rolesAtLeast(EVIDENCE_MIN_ROLE));

/** The caller holds the draft and hands it back each turn. */
interface AssistantTurnBody {
  text?: string;
  draft?: QuickEntryDraft | null;
}

async function handleTurn(orgId: string, body: AssistantTurnBody, res: any) {
  const text = String(body?.text ?? "");
  const result = await runAssistantTurn(orgId, body?.draft ?? null, text);
  res.json(result);
}

/** Authenticated routes for the typed command bar and mic input in the web/mobile app. */
export function registerAssistantRoutes(app: Express, scoped: RequestHandler[]): void {
  app.post("/api/assistant/turn", ...scoped, async (req: any, res) => {
    try {
      const orgId = req.orgContext?.orgId as string | undefined;
      if (!orgId) return res.status(400).json({ message: "Org context required" });
      await handleTurn(orgId, req.body ?? {}, res);
    } catch (e: any) {
      console.error("[assistant] turn:", e);
      sendServerError(res, e, "Assistant turn failed");
    }
  });

  app.get("/api/assistant/summary", ...scoped, evidenceRoles, async (req: any, res) => {
    try {
      const orgId = req.orgContext?.orgId as string | undefined;
      if (!orgId) return res.status(400).json({ message: "Org context required" });
      const text = await getDailySummary(orgId);
      res.json({ text });
    } catch (e: any) {
      console.error("[assistant] summary:", e);
      sendServerError(res, e, "Failed to build summary");
    }
  });

  app.get("/api/assistant/alerts", ...scoped, evidenceRoles, async (req: any, res) => {
    try {
      const orgId = req.orgContext?.orgId as string | undefined;
      if (!orgId) return res.status(400).json({ message: "Org context required" });
      const alerts = await getAssistantAlerts(orgId);
      res.json({ alerts });
    } catch (e: any) {
      console.error("[assistant] alerts:", e);
      sendServerError(res, e, "Failed to load alerts");
    }
  });
}
