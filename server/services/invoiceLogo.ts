import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

type LookupAddress = { address: string; family: number };
type LookupFn = (hostname: string) => Promise<LookupAddress[]>;
type FetchFn = typeof fetch;

export type InvoiceLogoFetchOptions = {
  fetchImpl?: FetchFn;
  lookup?: LookupFn;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
};

export const INVOICE_LOGO_MAX_BYTES = 1_000_000;
export const INVOICE_LOGO_TIMEOUT_MS = 5_000;
const INVOICE_LOGO_MAX_REDIRECTS = 3;

const IPV4_BLOCKED_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

const IPV6_BLOCKED_RANGES: Array<[bigint, number]> = [
  [0n, 128], // unspecified
  [1n, 128], // loopback
  [0xfc00n << 112n, 7], // unique-local
  [0xfe80n << 112n, 10], // link-local
  [0xff00n << 112n, 8], // multicast
  [0x20010db8n << 96n, 32], // documentation
  [0x2002n << 112n, 16], // 6to4
  [0x20010000n << 96n, 23], // IETF protocol assignments
];

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function ipv4InRange(address: string, base: string, prefixLength: number): boolean {
  const value = ipv4ToInt(address);
  const baseValue = ipv4ToInt(base);
  if (value == null || baseValue == null) return false;
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function parseIpv6(address: string): bigint | null {
  let normalized = address.toLowerCase().replace(/%.*$/, "");
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = normalized.slice(lastColon + 1);
    const ipv4Value = ipv4ToInt(ipv4);
    if (ipv4Value == null) return null;
    const high = ((ipv4Value >>> 16) & 0xffff).toString(16);
    const low = (ipv4Value & 0xffff).toString(16);
    normalized = `${normalized.slice(0, lastColon)}:${high}:${low}`;
  }

  const [leftRaw, rightRaw, extra] = normalized.split("::");
  if (extra !== undefined) return null;
  const left = leftRaw ? leftRaw.split(":").filter(Boolean) : [];
  const right = rightRaw ? rightRaw.split(":").filter(Boolean) : [];
  const fill = normalized.includes("::") ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array(Math.max(fill, 0)).fill("0"), ...right];
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) + BigInt(parseInt(group, 16));
  }
  return value;
}

function ipv6InRange(value: bigint, base: bigint, prefixLength: number): boolean {
  if (prefixLength === 0) return true;
  const shift = BigInt(128 - prefixLength);
  return (value >> shift) === (base >> shift);
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, "$1");
}

export function isPubliclyRoutableIp(address: string): boolean {
  const normalized = stripIpv6Brackets(address);
  const family = net.isIP(normalized);
  if (family === 4) {
    return !IPV4_BLOCKED_RANGES.some(([base, prefixLength]) => ipv4InRange(normalized, base, prefixLength));
  }
  if (family === 6) {
    const value = parseIpv6(normalized);
    if (value == null) return false;
    if (normalized.toLowerCase().startsWith("::ffff:")) {
      const mapped = normalized.slice("::ffff:".length);
      return net.isIP(mapped) === 4 && isPubliclyRoutableIp(mapped);
    }
    return !IPV6_BLOCKED_RANGES.some(([base, prefixLength]) => ipv6InRange(value, base, prefixLength));
  }
  return false;
}

async function defaultLookup(hostname: string): Promise<LookupAddress[]> {
  const result = await dnsLookup(hostname, { all: true, verbatim: false });
  return result.map(({ address, family }) => ({ address, family }));
}

async function validateLogoUrl(url: URL, lookup: LookupFn): Promise<boolean> {
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;

  const hostname = stripIpv6Brackets(url.hostname);
  const ipFamily = net.isIP(hostname);
  const addresses = ipFamily ? [{ address: hostname, family: ipFamily }] : await lookup(hostname);
  return addresses.length > 0 && addresses.every(({ address }) => isPubliclyRoutableIp(address));
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer | undefined> {
  if (!response.body) return Buffer.from(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) return undefined;
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function fetchInvoiceLogo(
  logoUrl: string,
  options: InvoiceLogoFetchOptions = {},
): Promise<Buffer | undefined> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookup = options.lookup ?? defaultLookup;
  const maxBytes = options.maxBytes ?? INVOICE_LOGO_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? INVOICE_LOGO_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? INVOICE_LOGO_MAX_REDIRECTS;

  try {
    let currentUrl = new URL(logoUrl);
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      if (!(await validateLogoUrl(currentUrl, lookup))) return undefined;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(currentUrl.toString(), {
          redirect: "manual",
          signal: controller.signal,
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location) return undefined;
          currentUrl = new URL(location, currentUrl);
          continue;
        }

        if (!response.ok) return undefined;
        const body = await readBoundedBody(response, maxBytes);
        return body && body.length <= maxBytes ? body : undefined;
      } finally {
        clearTimeout(timeout);
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export async function loadInvoiceLogo(
  org: { invoiceLogoEnabled: boolean; logoUrl: string | null },
  options?: InvoiceLogoFetchOptions,
): Promise<Buffer | undefined> {
  if (!org.invoiceLogoEnabled || !org.logoUrl) return undefined;
  return fetchInvoiceLogo(org.logoUrl, options);
}
