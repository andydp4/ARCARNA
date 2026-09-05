import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { requireRole } from "../auth";
import { assertPublicHttpsUrl } from "../lib/safeUrl";

/** C2 / C4 — org-scoped API keys and outbound webhooks (session auth). */
export function registerChannelAuthenticatedRoutes(
  app: Express,
  scoped: RequestHandler[],
): void {
  app.get(
    "/api/api-keys",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
    async (req: any, res) => {
      try {
        const orgId = req.orgContext.orgId as string;
        const rows = await storage.listApiKeysForOrg(orgId);
        res.json(
          rows.map((k) => ({
            id: k.id,
            name: k.name,
            keyLookup: k.keyLookup,
            scopes: k.scopes,
            createdAt: k.createdAt,
            revokedAt: k.revokedAt,
          })),
        );
      } catch (e) {
        console.error("[channels] list keys:", e);
        res.status(500).json({ message: "Failed to list API keys" });
      }
    },
  );

  app.post(
    "/api/api-keys",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = req.orgContext.orgId as string;
        const name = String(req.body?.name ?? "").trim() || "API key";
        const scopes = Array.isArray(req.body?.scopes)
          ? (req.body.scopes as unknown[]).map((s) => String(s))
          : undefined;
        const created = await storage.createApiKeyForOrg(orgId, name, scopes);
        res.status(201).json({
          id: created.id,
          name: created.name,
          keyLookup: created.keyLookup,
          /** Shown once — store securely; not retrievable later. */
          plainKey: created.plainKey,
          createdAt: created.createdAt,
        });
      } catch (e) {
        console.error("[channels] create key:", e);
        res.status(500).json({ message: "Failed to create API key" });
      }
    },
  );

  app.post(
    "/api/api-keys/:id/revoke",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = req.orgContext.orgId as string;
        await storage.revokeApiKey(req.params.id, orgId);
        res.json({ ok: true });
      } catch (e) {
        console.error("[channels] revoke key:", e);
        res.status(500).json({ message: "Failed to revoke API key" });
      }
    },
  );

  app.get(
    "/api/webhooks",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = req.orgContext.orgId as string;
        const rows = await storage.listOutboundWebhooksForOrg(orgId);
        res.json(
          rows.map((w) => ({
            id: w.id,
            url: w.url,
            eventTypes: w.eventTypes,
            isActive: w.isActive,
            createdAt: w.createdAt,
          })),
        );
      } catch (e) {
        console.error("[channels] list webhooks:", e);
        res.status(500).json({ message: "Failed to list webhooks" });
      }
    },
  );

  app.post(
    "/api/webhooks",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = req.orgContext.orgId as string;
        const url = String(req.body?.url ?? "").trim();
        const secret = String(req.body?.secret ?? "").trim();
        const eventTypes = Array.isArray(req.body?.eventTypes)
          ? (req.body.eventTypes as unknown[]).map((s) => String(s))
          : undefined;
        // startsWith("https://") is a string test, not a network one:
        // "https://127.0.0.1:5000/" and "https://169.254.169.254/" both pass it.
        // Resolve the host and reject private ranges. Delivery re-checks too —
        // this is here so an admin gets a clear error now rather than a webhook
        // that is silently skipped forever.
        if (!(await assertPublicHttpsUrl(url))) {
          return res.status(400).json({
            message:
              "Webhook URL must be https:// and resolve to a public address",
          });
        }
        if (secret.length < 16) {
          return res.status(400).json({ message: "secret must be at least 16 characters" });
        }
        const row = await storage.createOutboundWebhook(orgId, { url, secret, eventTypes });
        res.status(201).json({
          id: row.id,
          url: row.url,
          eventTypes: row.eventTypes,
          isActive: row.isActive,
          createdAt: row.createdAt,
        });
      } catch (e) {
        console.error("[channels] create webhook:", e);
        res.status(500).json({ message: "Failed to create webhook" });
      }
    },
  );
}
