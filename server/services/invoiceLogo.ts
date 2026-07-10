import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { IncomingHttpHeaders } from "node:http";

export type InvoiceLogoOrg = {
  invoiceLogoEnabled: boolean;
  logoUrl: string | null;
};

type LookupAll = (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAddress[]>;

type LogoHttpResponse = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
};

type LogoRequest = (
  url: URL,
  options: {
    lookupAddress: LookupAddress;
    timeoutMs: number;
    maxBytes: number;
  },
) => Promise<LogoHttpResponse>;

export type InvoiceLogoFetchOptions = {
  lookup?: LookupAll;
  request?: LogoRequest;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

function parseIPv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : Number.NaN;
  });
  return octets.every(Number.isFinite) ? octets : null;
}

function isPrivateOrReservedIPv4(address: string): boolean {
  const octets = parseIPv4(address);
  if (!octets) return true;
  const [a, b] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 0 && octets[2] === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a >= 224
  );
}

function isPrivateOrReservedIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  const mappedPrefix = "::ffff:";
  if (normalized.startsWith(mappedPrefix)) {
    return isPrivateOrReservedIPv4(normalized.slice(mappedPrefix.length));
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

export function isPrivateOrReservedIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateOrReservedIPv4(address);
  if (family === 6) return isPrivateOrReservedIPv6(address);
  return true;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost" || normalized.endsWith(".localhost");
}

async function resolvePublicAddress(url: URL, lookup: LookupAll): Promise<LookupAddress> {
  if (url.protocol !== "https:") {
    throw new Error("Invoice logo URL must use HTTPS");
  }

  if (isBlockedHostname(url.hostname)) {
    throw new Error("Invoice logo URL host is not allowed");
  }

  const literalFamily = isIP(url.hostname);
  if (literalFamily) {
    if (isPrivateOrReservedIp(url.hostname)) {
      throw new Error("Invoice logo URL resolves to a private or reserved address");
    }
    return { address: url.hostname, family: literalFamily };
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error("Invoice logo URL host did not resolve");
  }

  for (const address of addresses) {
    if (isPrivateOrReservedIp(address.address)) {
      throw new Error("Invoice logo URL resolves to a private or reserved address");
    }
  }

  return addresses[0];
}

function firstHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

async function requestLogo(
  url: URL,
  { lookupAddress, timeoutMs, maxBytes }: { lookupAddress: LookupAddress; timeoutMs: number; maxBytes: number },
): Promise<LogoHttpResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const req = httpsRequest(
      url,
      {
        method: "GET",
        headers: { Accept: "image/*" },
        timeout: timeoutMs,
        lookup: (_hostname, _options, callback) => {
          callback(null, lookupAddress.address, lookupAddress.family);
        },
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        const headers = res.headers;
        const contentLength = Number(firstHeader(headers, "content-length") ?? 0);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          res.destroy();
          finish(() => reject(new Error("Invoice logo response is too large")));
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume();
          finish(() => resolve({ statusCode, headers, body: Buffer.alloc(0) }));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            res.destroy();
            finish(() => reject(new Error("Invoice logo response exceeded the size limit")));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        res.on("end", () => {
          finish(() => resolve({ statusCode, headers, body: Buffer.concat(chunks) }));
        });
        res.on("error", (error) => finish(() => reject(error)));
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("Invoice logo request timed out"));
    });
    req.on("error", (error) => finish(() => reject(error)));
    req.end();
  });
}

async function fetchInvoiceLogoBytes(rawUrl: string, options: InvoiceLogoFetchOptions = {}): Promise<Buffer | undefined> {
  const lookup = options.lookup ?? dnsLookup;
  const request = options.request ?? requestLogo;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  let current = new URL(rawUrl);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const lookupAddress = await resolvePublicAddress(current, lookup);
    const response = await request(current, { lookupAddress, timeoutMs, maxBytes });

    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = firstHeader(response.headers, "location");
      if (!location || redirects === maxRedirects) return undefined;
      current = new URL(location, current);
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return undefined;
    }

    if (response.body.length > maxBytes) {
      throw new Error("Invoice logo response exceeded the size limit");
    }
    return response.body;
  }

  return undefined;
}

/** Fetches the org's logo bytes for invoice branding, if enabled and configured. Never throws. */
export async function loadInvoiceLogo(
  org: InvoiceLogoOrg,
  options: InvoiceLogoFetchOptions = {},
): Promise<Buffer | undefined> {
  if (!org.invoiceLogoEnabled || !org.logoUrl) return undefined;
  try {
    return await fetchInvoiceLogoBytes(org.logoUrl, options);
  } catch (error) {
    console.error("[Invoices] Failed to fetch invoice logo:", error);
    return undefined;
  }
}
