import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard for any server-side fetch of a URL a tenant supplied.
 *
 * Lifted out of invoiceLogo.ts, where it was module-private. That is why
 * server/webhooks/outboundNotify.ts never used it and posted straight to
 * `fetch(h.url)` — the registration route's only check was
 * `url.startsWith("https://")`, a string test that "https://127.0.0.1:5000/",
 * "https://169.254.169.254/" and "https://10.0.0.5/" all satisfy.
 *
 * Resolve BEFORE every fetch, not once at registration. A hostname that
 * resolved publicly when it was saved can resolve to a private address later —
 * DNS rebinding is exactly this attack, and a registration-time-only check
 * cannot see it.
 */

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isBlockedIpv4(mapped[1]) : false;
}

export function isBlockedAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isBlockedIpv4(address);
  if (kind === 6) return isBlockedIpv6(address);
  return true;
}

export async function assertPublicHttpsUrl(rawUrl: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  // URL.hostname keeps the brackets on an IPv6 literal ("[::1]"), and isIP()
  // does not recognise that form — so "https://[::1]/" was not treated as a
  // literal at all and fell through to DNS, where it threw ENOTFOUND.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) return null;

  const literalKind = isIP(hostname);
  let addresses: { address: string }[];
  if (literalKind) {
    addresses = [{ address: hostname }];
  } else {
    try {
      addresses = await lookup(hostname, { all: true });
    } catch {
      // Fail closed. This used to propagate: a hostname that does not resolve
      // made the guard THROW rather than return null, so every caller had to
      // handle an exception from what reads like a predicate. The webhook
      // sender did not, and the registration route turned it into a 500.
      return null;
    }
  }

  if (addresses.length === 0 || addresses.some((entry) => isBlockedAddress(entry.address))) {
    return null;
  }
  return url;
}
