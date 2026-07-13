import dns from "node:dns/promises";
import { Buffer } from "node:buffer";
import { isIP } from "node:net";

export type InvoiceLogoOrg = {
  invoiceLogoEnabled: boolean;
  logoUrl: string | null;
};

export type LookupAddress = { address: string; family: number };
export type InvoiceLogoLookup = (hostname: string) => Promise<LookupAddress[]>;

type InvoiceLogoFetch = typeof fetch;

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

async function defaultLookup(hostname: string): Promise<LookupAddress[]> {
  return dns.lookup(hostname, { all: true });
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a >= 224) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
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
    return false;
  }
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4) return isPublicIpv4(mappedIpv4[1]);
  return true;
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export async function validateInvoiceLogoUrl(
  rawUrl: string,
  lookup: InvoiceLogoLookup = defaultLookup,
): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || !url.hostname) return null;

  const literalFamily = isIP(url.hostname);
  const addresses = literalFamily
    ? [{ address: url.hostname, family: literalFamily }]
    : await lookup(url.hostname).catch(() => []);

  if (addresses.length === 0 || addresses.some((record) => !isPublicIpAddress(record.address))) {
    return null;
  }

  return url;
}

async function readResponseBodyLimited(response: Response, maxBytes: number): Promise<Buffer | undefined> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) return undefined;
  if (!response.body) return undefined;

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) return undefined;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function fetchWithTimeout(url: URL, fetchFn: InvoiceLogoFetch, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    return await fetchFn(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "image/*" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetches the org's logo bytes for invoice branding, if enabled and configured. Never throws. */
export async function loadInvoiceLogo(
  org: InvoiceLogoOrg,
  options: {
    fetchFn?: InvoiceLogoFetch;
    lookup?: InvoiceLogoLookup;
    timeoutMs?: number;
    maxBytes?: number;
  } = {},
): Promise<Buffer | undefined> {
  if (!org.invoiceLogoEnabled || !org.logoUrl) return undefined;

  const fetchFn = options.fetchFn ?? fetch;
  const lookup = options.lookup ?? defaultLookup;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  try {
    let currentUrl = await validateInvoiceLogoUrl(org.logoUrl, lookup);
    if (!currentUrl) return undefined;

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await fetchWithTimeout(currentUrl, fetchFn, timeoutMs);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return undefined;
        currentUrl = await validateInvoiceLogoUrl(new URL(location, currentUrl).toString(), lookup);
        if (!currentUrl) return undefined;
        continue;
      }

      if (!response.ok) return undefined;
      const contentType = response.headers.get("content-type");
      if (contentType && !contentType.toLowerCase().startsWith("image/")) return undefined;
      return readResponseBodyLimited(response, maxBytes);
    }
  } catch (error) {
    console.error("[Invoices] Failed to fetch invoice logo:", error);
  }

  return undefined;
}
