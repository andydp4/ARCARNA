import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export const INVOICE_LOGO_MAX_BYTES = 512 * 1024;
const INVOICE_LOGO_TIMEOUT_MS = 3_000;
const INVOICE_LOGO_MAX_REDIRECTS = 2;

type FetchLike = typeof fetch;

type ResolveResult = {
  address: string;
  family: number;
};

type LoadInvoiceLogoOptions = {
  fetchImpl?: FetchLike;
  resolveHost?: (hostname: string) => Promise<ResolveResult[]>;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
};

type InvoiceLogoOrg = {
  invoiceLogoEnabled: boolean;
  logoUrl: string | null;
};

const IPV4_PRIVATE_RANGES: Array<[number, number]> = [
  [ipToNumber("0.0.0.0"), 8],
  [ipToNumber("10.0.0.0"), 8],
  [ipToNumber("100.64.0.0"), 10],
  [ipToNumber("127.0.0.0"), 8],
  [ipToNumber("169.254.0.0"), 16],
  [ipToNumber("172.16.0.0"), 12],
  [ipToNumber("192.0.0.0"), 24],
  [ipToNumber("192.0.2.0"), 24],
  [ipToNumber("192.168.0.0"), 16],
  [ipToNumber("198.18.0.0"), 15],
  [ipToNumber("198.51.100.0"), 24],
  [ipToNumber("203.0.113.0"), 24],
  [ipToNumber("224.0.0.0"), 4],
  [ipToNumber("240.0.0.0"), 4],
];

function ipToNumber(address: string): number {
  return address
    .split(".")
    .reduce((total, octet) => (total << 8) + Number.parseInt(octet, 10), 0) >>> 0;
}

function ipv4InCidr(address: string, base: number, prefix: number): boolean {
  const ip = ipToNumber(address);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (base & mask);
}

function isPrivateIpv4(address: string): boolean {
  return IPV4_PRIVATE_RANGES.some(([base, prefix]) => ipv4InCidr(address, base, prefix));
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0];
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);

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

function isBlockedNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function defaultResolveHost(hostname: string): Promise<ResolveResult[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

async function assertSafeHttpsUrl(
  url: URL,
  resolveHost: (hostname: string) => Promise<ResolveResult[]>,
): Promise<boolean> {
  if (url.protocol !== "https:") return false;

  if (isIP(url.hostname)) {
    return !isBlockedNetworkAddress(url.hostname);
  }

  const addresses = await resolveHost(url.hostname);
  return addresses.length > 0 && addresses.every(({ address }) => !isBlockedNetworkAddress(address));
}

function timeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref();
  return controller.signal;
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer | undefined> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) {
    return undefined;
  }

  if (!response.body) return Buffer.alloc(0);

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

async function fetchSafeLogo(
  url: URL,
  options: Required<LoadInvoiceLogoOptions>,
  redirectsRemaining: number,
): Promise<Buffer | undefined> {
  const safe = await assertSafeHttpsUrl(url, options.resolveHost);
  if (!safe) return undefined;

  const response = await options.fetchImpl(url, {
    redirect: "manual",
    signal: timeoutSignal(options.timeoutMs),
  });

  if (response.status >= 300 && response.status < 400) {
    if (redirectsRemaining <= 0) return undefined;
    const location = response.headers.get("location");
    if (!location) return undefined;
    return fetchSafeLogo(new URL(location, url), options, redirectsRemaining - 1);
  }

  if (!response.ok) return undefined;
  return readLimitedBody(response, options.maxBytes);
}

/** Fetches org logo bytes for invoice PDFs without allowing internal network access or unbounded reads. */
export async function loadInvoiceLogo(
  org: InvoiceLogoOrg,
  options: LoadInvoiceLogoOptions = {},
): Promise<Buffer | undefined> {
  if (!org.invoiceLogoEnabled || !org.logoUrl) return undefined;

  try {
    return await fetchSafeLogo(
      new URL(org.logoUrl),
      {
        fetchImpl: options.fetchImpl ?? fetch,
        resolveHost: options.resolveHost ?? defaultResolveHost,
        maxBytes: options.maxBytes ?? INVOICE_LOGO_MAX_BYTES,
        timeoutMs: options.timeoutMs ?? INVOICE_LOGO_TIMEOUT_MS,
        maxRedirects: options.maxRedirects ?? INVOICE_LOGO_MAX_REDIRECTS,
      },
      options.maxRedirects ?? INVOICE_LOGO_MAX_REDIRECTS,
    );
  } catch (error) {
    console.error("[Invoices] Failed to fetch invoice logo:", error);
    return undefined;
  }
}
