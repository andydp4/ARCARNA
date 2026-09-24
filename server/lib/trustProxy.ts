import type { Request } from "express";

/**
 * Which proxies Express may believe about the client's address (v1.2.1
 * SEC-XFF).
 *
 * It used to be `1` (trust one hop, whoever it is). With the Node port
 * reachable directly, a caller then chose their own `req.ip` by sending
 * `X-Forwarded-For`, which let them look like localhost and rotate past the
 * per-IP rate limits. The deploy puts nginx on the same box, proxying to
 * 127.0.0.1, so only a loopback peer is trusted: nginx's appended address is
 * believed, a caller's own header is not. `TRUST_PROXY` overrides it (same
 * syntax as Express's "trust proxy") for a proxy on another host.
 */
export function trustProxySetting(): string | number | boolean {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return "loopback";
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * True only when the TCP peer itself is this machine. Judged on the socket,
 * never on `req.ip`, which proxy headers can set.
 */
export function isLoopbackPeer(req: Pick<Request, "socket">): boolean {
  const addr = (req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress ?? "";
  return LOOPBACK.has(addr);
}
