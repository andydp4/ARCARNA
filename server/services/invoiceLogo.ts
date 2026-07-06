import dns from "node:dns/promises";
import net from "node:net";
import type { LookupAddress } from "node:dns";

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_BYTES = 1_024 * 1_024;
const DEFAULT_MAX_REDIRECTS = 3;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type LookupLike = typeof dns.lookup;

type InvoiceLogoFetchDeps = {
  fetch?: FetchLike;
  lookup?: LookupLike;
};

type InvoiceLogoFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

export async function loadInvoiceLogo(
  org: { invoiceLogoEnabled: boolean; logoUrl: string | null },
  options: InvoiceLogoFetchOptions = {},
  deps: InvoiceLogoFetchDeps = {},
): Promise<Buffer | undefined> {
  if (!org.invoiceLogoEnabled || !org.logoUrl?.trim()) return undefined;

  try {
    return await fetchTrustedImage(
      new URL(org.logoUrl.trim()),
      {
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
        maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
      },
      deps,
    );
  } catch (error) {
    console.error("[Invoices] Failed to fetch invoice logo:", error);
    return undefined;
  }
}

async function fetchTrustedImage(
  startUrl: URL,
  options: Required<InvoiceLogoFetchOptions>,
  deps: InvoiceLogoFetchDeps,
): Promise<Buffer | undefined> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const lookup = deps.lookup ?? dns.lookup;
  let url = startUrl;

  for (let redirect = 0; redirect <= options.maxRedirects; redirect += 1) {
    await assertSafeRemoteHttpsUrl(url, lookup);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetchImpl(url, {
        redirect: "manual",
        signal: controller.signal,
      });

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) return undefined;
        url = new URL(location, url);
        continue;
      }

      if (!response.ok || !response.body) return undefined;
      return await readBoundedBody(response.body, options.maxBytes);
    } finally {
      clearTimeout(timeout);
    }
  }

  return undefined;
}

async function assertSafeRemoteHttpsUrl(url: URL, lookup: LookupLike): Promise<void> {
  if (url.protocol !== "https:") {
    throw new Error("Invoice logo URL must use HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("Invoice logo URL must not include credentials");
  }

  const hostname = stripIpv6Brackets(url.hostname);
  if (isBlockedAddress(hostname)) {
    throw new Error("Invoice logo URL points to a blocked address");
  }

  if (net.isIP(hostname)) return;

  const records = (await lookup(hostname, { all: true, verbatim: false })) as LookupAddress[];
  if (records.length === 0 || records.some((record) => isBlockedAddress(record.address))) {
    throw new Error("Invoice logo host resolves to a blocked address");
  }
}

async function readBoundedBody(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Buffer | undefined> {
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Invoice logo exceeds maximum size");
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isBlockedAddress(address: string): boolean {
  const normalized = stripIpv6Brackets(address).split("%")[0];
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return isBlockedIpv4(normalized);
  if (ipVersion === 6) return isBlockedIpv6(normalized);
  return false;
}

function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value == null) return true;

  return [
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
  ].some(([range, prefix]) => ipv4InRange(value, range as string, prefix as number));
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function ipv4InRange(value: number, range: string, prefix: number): boolean {
  const base = ipv4ToInt(range);
  if (base == null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function isBlockedIpv6(address: string): boolean {
  const value = ipv6ToBigInt(address);
  if (value == null) return true;

  return [
    ["::", 128],
    ["::1", 128],
    ["::ffff:0:0", 96],
    ["64:ff9b::", 96],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ].some(([range, prefix]) => ipv6InRange(value, range as string, prefix as number));
}

function ipv6InRange(value: bigint, range: string, prefix: number): boolean {
  const base = ipv6ToBigInt(range);
  if (base == null) return false;
  const shift = BigInt(128 - prefix);
  return (value >> shift) === (base >> shift);
}

function ipv6ToBigInt(address: string): bigint | null {
  let normalized = address.toLowerCase().split("%")[0];
  const embeddedIpv4 = normalized.match(/(^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embeddedIpv4) {
    const ipv4 = ipv4ToInt(embeddedIpv4[2]);
    if (ipv4 == null) return null;
    const high = ((ipv4 >>> 16) & 0xffff).toString(16);
    const low = (ipv4 & 0xffff).toString(16);
    normalized = normalized.slice(0, -embeddedIpv4[2].length) + `${high}:${low}`;
  }

  const compressed = normalized.split("::");
  if (compressed.length > 2) return null;

  const head = compressed[0] ? compressed[0].split(":").filter(Boolean) : [];
  const tail = compressed[1] ? compressed[1].split(":").filter(Boolean) : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;

  const groups = compressed.length === 2
    ? [...head, ...Array(fill).fill("0"), ...tail]
    : head;
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) + BigInt(parseInt(group, 16));
  }
  return value;
}
