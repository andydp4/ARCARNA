import { describe, expect, it, vi } from "vitest";
import { loadInvoiceLogo } from "../services/invoiceLogo";

const publicLookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

function imageResponse(body: Uint8Array, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "image/png" },
    ...init,
  });
}

describe("invoice logo fetching", () => {
  it("fetches a public HTTPS logo within the byte limit", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(async () => imageResponse(bytes));

    const logo = await loadInvoiceLogo(
      { invoiceLogoEnabled: true, logoUrl: "https://cdn.example/logo.png" },
      { maxBytes: 16 },
      { fetch: fetchMock, lookup: publicLookup as any },
    );

    expect(logo).toEqual(Buffer.from(bytes));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://cdn.example/logo.png"),
      expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) }),
    );
  });

  it("does not fetch plaintext URLs", async () => {
    const fetchMock = vi.fn();

    const logo = await loadInvoiceLogo(
      { invoiceLogoEnabled: true, logoUrl: "http://cdn.example/logo.png" },
      undefined,
      { fetch: fetchMock as any, lookup: publicLookup as any },
    );

    expect(logo).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks private IP literals before fetching", async () => {
    const fetchMock = vi.fn();

    const logo = await loadInvoiceLogo(
      { invoiceLogoEnabled: true, logoUrl: "https://127.0.0.1/logo.png" },
      undefined,
      { fetch: fetchMock as any, lookup: publicLookup as any },
    );

    expect(logo).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks hostnames that resolve to private addresses", async () => {
    const fetchMock = vi.fn();
    const lookup = vi.fn(async () => [{ address: "169.254.169.254", family: 4 }]);

    const logo = await loadInvoiceLogo(
      { invoiceLogoEnabled: true, logoUrl: "https://metadata.example/logo.png" },
      undefined,
      { fetch: fetchMock as any, lookup: lookup as any },
    );

    expect(logo).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks redirects to unsafe targets", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/latest/meta-data" },
      }),
    );

    const logo = await loadInvoiceLogo(
      { invoiceLogoEnabled: true, logoUrl: "https://cdn.example/logo.png" },
      undefined,
      { fetch: fetchMock as any, lookup: publicLookup as any },
    );

    expect(logo).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts slow logo responses", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );

    const logo = await loadInvoiceLogo(
      { invoiceLogoEnabled: true, logoUrl: "https://cdn.example/logo.png" },
      { timeoutMs: 1 },
      { fetch: fetchMock, lookup: publicLookup as any },
    );

    expect(logo).toBeUndefined();
  });

  it("drops oversized logo responses", async () => {
    const fetchMock = vi.fn(async () => imageResponse(new Uint8Array([1, 2, 3, 4])));

    const logo = await loadInvoiceLogo(
      { invoiceLogoEnabled: true, logoUrl: "https://cdn.example/logo.png" },
      { maxBytes: 3 },
      { fetch: fetchMock, lookup: publicLookup as any },
    );

    expect(logo).toBeUndefined();
  });
});
