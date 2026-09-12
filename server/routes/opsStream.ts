/**
 * `GET /api/orders/board/stream` — Server-Sent Events for the Operations
 * Centre board.
 *
 * The route itself never reads the database except to touch presence
 * (`ops_staff.last_seen_at`), and that write is throttled to once per
 * org:user per 60 seconds — see `touchPresence` below. Everything a tablet
 * sees is relayed from `opsBus`, which other routes publish to AFTER their
 * own transaction commits. That is the whole mechanism behind the brief's
 * "zero database reads while nothing changes": four idle tablets are four
 * open sockets and four subscriptions to an `EventEmitter`, nothing more.
 *
 * Headers, pings and replay follow the brief's "GET /api/orders/board/stream"
 * paragraph exactly: `text/event-stream`, `res.flushHeaders()` and
 * `res.flush()` after every write (the global `compression()` middleware
 * would otherwise buffer everything until the response closes — Express
 * attaches `flush` to the response when that middleware is mounted), a
 * `: ping` comment every 25 seconds (nginx `proxy_read_timeout 120s`, and
 * Cloudflare drops an idle proxied connection at roughly 100s), `retry: 3000`
 * so a dropped tablet's built-in reconnect does not hammer the server, and an
 * `id:` on every event so a reconnect's `Last-Event-ID` can ask `opsBus` to
 * replay from exactly where it left off.
 */
import type { Express, RequestHandler } from "express";
import { subscribeOpsEvents, replaySince, type OpsBusEntry } from "../services/opsBus";
import { db } from "../db";
import { opsStaff } from "@shared/schema";

/** One write per org:user per 60s — see the module doc and the brief's presence row. */
const PRESENCE_THROTTLE_MS = 60_000;
const PING_INTERVAL_MS = 25_000;

const lastPresenceWrite = new Map<string, number>();

/**
 * Upserts `ops_staff.last_seen_at` for one user, but at most once per
 * `PRESENCE_THROTTLE_MS` — presence is a display and routing hint, not an
 * audit record (brief, "Stations & presence"), and it must not cost a write
 * per poll or per connected tablet per ping.
 */
export async function touchPresence(orgId: string, userId: string | null | undefined, now = Date.now()): Promise<void> {
  if (!orgId || !userId) return;
  const key = `${orgId}:${userId}`;
  const last = lastPresenceWrite.get(key);
  if (last !== undefined && now - last < PRESENCE_THROTTLE_MS) return;
  lastPresenceWrite.set(key, now);

  try {
    await db
      .insert(opsStaff)
      .values({ orgId, userId, lastSeenAt: new Date(now) })
      .onConflictDoUpdate({
        target: [opsStaff.orgId, opsStaff.userId],
        set: { lastSeenAt: new Date(now) },
      });
  } catch (error) {
    // Presence is a nicety, not the point of the connection: a write failure
    // here must never take the stream down.
    console.error("[opsStream] presence touch failed:", error);
  }
}

/** Test-only: forgets every throttle entry so specs start from nothing. */
export function __resetPresenceThrottleForTests(): void {
  lastPresenceWrite.clear();
}

function writeSseLine(res: { write: (chunk: string) => unknown; flush?: () => unknown }, line: string): void {
  res.write(line);
  res.flush?.();
}

function writeEntry(res: { write: (chunk: string) => unknown; flush?: () => unknown }, entry: OpsBusEntry): void {
  writeSseLine(res, `id: ${entry.id}\ndata: ${JSON.stringify(entry.event)}\n\n`);
}

/** Registers the SSE route. `scoped` is the same `[isAuthenticated, requireOrgContext, requireOrgScope]` chain every board-adjacent route uses. */
export function registerOpsStreamRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/orders/board/stream", ...scoped, (req: any, res: any) => {
    const ctx = req.orgContext as { orgId: string | null } | undefined;
    if (!ctx?.orgId) {
      res.status(400).json({ message: "Order stream requires org context." });
      return;
    }
    const orgId = ctx.orgId;
    const userId: string | null = req.user?.id ?? null;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Belt and braces alongside the nginx `proxy_buffering off` in the deploy
    // example — this header is the same instruction for any proxy that reads it.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    writeSseLine(res, "retry: 3000\n\n");

    const lastEventIdHeader = req.headers["last-event-id"] ?? req.query?.lastEventId;
    const lastEventId = Number(Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader);
    const replay = replaySince(orgId, Number.isFinite(lastEventId) ? lastEventId : 0);
    if (replay.gap) {
      // Told, not guessed: the client reloads the board over GET and opens a
      // fresh stream, rather than the route silently skipping events it can
      // no longer produce.
      writeSseLine(res, `event: reload\ndata: ${JSON.stringify({ reason: "gap" })}\n\n`);
    } else {
      for (const entry of replay.entries) writeEntry(res, entry);
    }

    const unsubscribe = subscribeOpsEvents(orgId, (entry) => writeEntry(res, entry));

    void touchPresence(orgId, userId);

    const pingInterval = setInterval(() => {
      writeSseLine(res, ": ping\n\n");
      // The stream connection's own heartbeat also counts as "seen" — a
      // tablet that never taps anything is still present at the counter.
      void touchPresence(orgId, userId);
    }, PING_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(pingInterval);
      unsubscribe();
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
  });
}
