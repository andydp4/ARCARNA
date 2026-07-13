import { describe, expect, it, vi } from "vitest";
import { loadInvoiceLogo, validateInvoiceLogoUrl, type InvoiceLogoLookup } from "../services/invoiceLogo";

const publicLookup: InvoiceLogoLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const privateLookup: InvoiceLogoLookup = async () => [{ address: "127.0.0.1", family: 4 }];

describe("validateInvoiceLogoUrl", () => {
  it("rejects non-HTTPS logo URLs", async () => {
    await expect(validateInvoiceLogoUrl("http://example.com/logo.png", publicLookup)).resolves.toBeNull();
  });

  it("rejects literal private and link-local addresses", async () => {
    await expect(validateInvoiceLogoUrl("https://127.0.0.1/logo.png", publicLookup)).resolves.toBeNull();
    await expect(validateInvoiceLogoUrl("https://169.254.169.254/latest/meta-data", publicLookup)).resolves.toBeNull();
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    await expect(validateInvoiceLogoUrl("https://metadata.internal/logo.png", privateLookup)).resolves.toBeNull();
  });

  it("accepts HTTPS hostnames resolving only to public addresses", async () => {
    await expect(validateInvoiceLogoUrl("https://example.com/logo.png", publicLookup)).resolves.toMatchObject({
      hostname: "example.com",
      protocol: "https:",
    });
  });
});

describe("loadInvoiceLogo", () => {
  it("does not fetch unsafe configured URLs", async () => {
    const fetchFn = vi.fn<typeof fetch>();

    await expect(
      loadInvoiceLogo(
        { invoiceLogoEnabled: true, logoUrl: "http://127.0.0.1/logo.png" },
        { fetchFn, lookup: publicLookup },
      ),
    ).resolves.toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects redirects to private addresses", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/logo.png" },
      }),
    );

    await expect(
      loadInvoiceLogo(
        { invoiceLogoEnabled: true, logoUrl: "https://example.com/logo.png" },
        { fetchFn, lookup: publicLookup },
      ),
    ).resolves.toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns image bytes for safe public URLs", async () => {
    const bytes = Buffer.from("png-bytes");
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    await expect(
      loadInvoiceLogo(
        { invoiceLogoEnabled: true, logoUrl: "https://example.com/logo.png" },
        { fetchFn, lookup: publicLookup },
      ),
    ).resolves.toEqual(bytes);
  });

  it("omits oversized responses", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(Buffer.alloc(8), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    await expect(
      loadInvoiceLogo(
        { invoiceLogoEnabled: true, logoUrl: "https://example.com/logo.png" },
        { fetchFn, lookup: publicLookup, maxBytes: 4 },
      ),
    ).resolves.toBeUndefined();
  });
});
