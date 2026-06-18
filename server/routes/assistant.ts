import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { runAssistantTurn } from "../assistant/engine";
import { getAssistantAlerts, getDailySummary } from "../assistant/alerts";
import type { QuickEntryDraft } from "../assistant/quickEntry";

/** Body shared by the web client and the Siri Shortcut: caller holds the draft, hands it back each turn. */
interface AssistantTurnBody {
  text?: string;
  draft?: QuickEntryDraft | null;
}

async function handleTurn(orgId: string, body: AssistantTurnBody, userId: string | undefined, res: any) {
  const text = String(body?.text ?? "");
  const result = await runAssistantTurn(orgId, body?.draft ?? null, text, userId);
  res.json(result);
}

/** Authenticated routes for the typed command bar and mic input in the web/mobile app. */
export function registerAssistantRoutes(app: Express, scoped: RequestHandler[]): void {
  app.post("/api/assistant/turn", ...scoped, async (req: any, res) => {
    try {
      const orgId = req.orgContext?.orgId as string | undefined;
      if (!orgId) return res.status(400).json({ message: "Org context required" });
      await handleTurn(orgId, req.body ?? {}, req.user?.id, res);
    } catch (e: any) {
      console.error("[assistant] turn:", e);
      res.status(500).json({ message: e?.message || "Assistant turn failed" });
    }
  });

  app.get("/api/assistant/summary", ...scoped, async (req: any, res) => {
    try {
      const orgId = req.orgContext?.orgId as string | undefined;
      if (!orgId) return res.status(400).json({ message: "Org context required" });
      const text = await getDailySummary(orgId);
      res.json({ text });
    } catch (e: any) {
      console.error("[assistant] summary:", e);
      res.status(500).json({ message: e?.message || "Failed to build summary" });
    }
  });

  app.get("/api/assistant/alerts", ...scoped, async (req: any, res) => {
    try {
      const orgId = req.orgContext?.orgId as string | undefined;
      if (!orgId) return res.status(400).json({ message: "Org context required" });
      const alerts = await getAssistantAlerts(orgId);
      res.json({ alerts });
    } catch (e: any) {
      console.error("[assistant] alerts:", e);
      res.status(500).json({ message: e?.message || "Failed to load alerts" });
    }
  });
}

/** Public, API-key-authenticated route for Siri Shortcuts ("Get Contents of URL" -> "Speak Text"). */
export function registerAssistantPublicRoutes(app: Express): void {
  app.post("/v1/orgs/:orgId/assistant/turn", async (req, res) => {
    try {
      const orgId = req.params.orgId;
      const auth = req.get("authorization") || "";
      const m = auth.match(/^Bearer\s+(\S+)\s*$/i);
      if (!m) return res.status(401).json({ message: "Authorization: Bearer <api_key> required" });
      const verified = await storage.verifyApiKeyAndGetOrg(m[1]);
      if (!verified || verified.orgId !== orgId) {
        return res.status(403).json({ message: "Invalid API key for this organization" });
      }
      if (!verified.scopes.includes("assistant:voice")) {
        return res.status(403).json({ message: "Missing assistant:voice scope" });
      }
      await handleTurn(orgId, req.body ?? {}, undefined, res);
    } catch (e: any) {
      console.error("[assistant] public turn:", e);
      res.status(500).json({ message: e?.message || "Assistant turn failed" });
    }
  });
}
