import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { isAuthenticated } from "../auth";
import { isUiSeenKey } from "@shared/uiSeen";
import { markUiKeysSeen } from "../services/uiSeen";

const bodySchema = z.object({
  keys: z
    .array(z.string().refine(isUiSeenKey, "Invalid key"))
    .min(1)
    .max(50),
});

/**
 * Records that the signed-in person has seen a piece of one-time UI (What's
 * New, a tour, a tutorial). Deliberately only `isAuthenticated`, not org
 * scoped: it is about the person, and a SUPER_ADMIN with no org selected sees
 * What's New too. The list comes back to the client on /api/auth/user as
 * `seenUi`, so nothing extra is fetched at start-up.
 */
export function registerUiSeenRoutes(app: Express, auth: RequestHandler = isAuthenticated): void {
  app.post("/api/me/seen", auth, async (req: any, res) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid body" });
    }
    const userId: string | undefined = req.user?.claims?.sub ?? req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    try {
      await markUiKeysSeen(userId, parsed.data.keys);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error recording seen UI:", error);
      res.status(500).json({ message: "Failed to record" });
    }
  });
}
