/**
 * A rate limit keyed on the signed-in person, not the internet address.
 *
 * Every till in a shop shares one address, so an IP limit either throttles
 * the whole counter or lets one person walk the phone book (PRV-06). One
 * process (see opsBus.ts), so an in-memory window is the whole store.
 */
import type { RequestHandler } from "express";

export function perPersonRateLimit(options: { windowMs: number; max: number; name: string; message?: string }): RequestHandler & {
  reset: () => void;
} {
  const hits = new Map<string, number[]>();
  const handler = ((req: any, res: any, next: any) => {
    const who: string | undefined = req.user?.id;
    if (!who) return res.status(401).json({ message: "Unauthorized" });
    const key = `${req.orgContext?.orgId ?? ""}:${who}`;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < options.windowMs);
    if (recent.length >= options.max) {
      hits.set(key, recent);
      const retryAfter = Math.max(1, Math.ceil((options.windowMs - (now - recent[0])) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        message: options.message ?? "Too many lookups. Wait a minute and try again.",
        code: `${options.name.toUpperCase()}_RATE_LIMITED`,
      });
    }
    recent.push(now);
    hits.set(key, recent);
    return next();
  }) as RequestHandler & { reset: () => void };
  handler.reset = () => hits.clear();
  return handler;
}
