import { assertPublicHttpsUrl } from "../lib/safeUrl";

const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_FETCH_TIMEOUT_MS = 3_000;
const MAX_REDIRECTS = 3;

async function readLimitedBody(res: Response, maxBytes = MAX_LOGO_BYTES): Promise<Buffer | undefined> {
  const contentLength = res.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) return undefined;
  if (!res.body) {
    const body = Buffer.from(await res.arrayBuffer());
    return body.length > maxBytes ? undefined : body;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export async function fetchInvoiceLogo(url: string): Promise<Buffer | undefined> {
  let current = url;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const safeUrl = await assertPublicHttpsUrl(current);
    if (!safeUrl) return undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(safeUrl, { redirect: "manual", signal: controller.signal });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return undefined;
        current = new URL(location, safeUrl).toString();
        continue;
      }
      if (!res.ok) return undefined;
      return readLimitedBody(res);
    } finally {
      clearTimeout(timeout);
    }
  }
  return undefined;
}

