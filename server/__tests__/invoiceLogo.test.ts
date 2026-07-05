import { describe, expect, it, vi } from "vitest";
import { INVOICE_LOGO_MAX_BYTES, loadInvoiceLogo } from "../services/invoiceLogo";

const enabledOrg = (logoUrl: string) => ({
  invoiceLogoEnabled: true,
  logoUrl,
});

const publicResolver = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]);

describe("invoice logo loading", () => {
  it("does not fetch non-HTTPS metadata URLs", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const resolveHost = vi.fn();

    const logo = await loadInvoiceLogo(enabledOrg("http://169.254.169.254/latest/meta-data"), {
      fetchImpl,
      resolveHost,
    });

    expect(logo).toBeUndefined();
    expect(resolveHost).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not fetch HTTPS hosts that resolve to private addresses", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const resolveHost = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);

    const logo = await loadInvoiceLogo(enabledOrg("https://example.com/logo.png"), {
      fetchImpl,
      resolveHost,
    });

    expect(logo).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("revalidates redirects before following them", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/logo.png" },
      }),
    );

    const logo = await loadInvoiceLogo(enabledOrg("https://cdn.example.com/logo.png"), {
      fetchImpl,
      resolveHost: publicResolver,
    });

    expect(logo).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops reading logos that exceed the byte limit", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array(INVOICE_LOGO_MAX_BYTES + 1), {
        status: 200,
      }),
    );

    const logo = await loadInvoiceLogo(enabledOrg("https://cdn.example.com/logo.png"), {
      fetchImpl,
      resolveHost: publicResolver,
    });

    expect(logo).toBeUndefined();
  });

  it("returns bytes for a safe HTTPS logo", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    const logo = await loadInvoiceLogo(enabledOrg("https://cdn.example.com/logo.png"), {
      fetchImpl,
      resolveHost: publicResolver,
    });

    expect(logo).toEqual(Buffer.from(bytes));
  });
});
