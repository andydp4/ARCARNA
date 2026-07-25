import { beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

describe("fetchInvoiceLogo", () => {
  beforeEach(() => {
    vi.resetModules();
    lookupMock.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("rejects non-HTTPS logo URLs before fetching", async () => {
    const { fetchInvoiceLogo } = await import("../services/invoiceLogo");
    await expect(fetchInvoiceLogo("http://127.0.0.1/logo.png")).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects DNS names that resolve to private addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const { fetchInvoiceLogo } = await import("../services/invoiceLogo");

    await expect(fetchInvoiceLogo("https://logo.example.test/image.png")).resolves.toBeUndefined();

    expect(lookupMock).toHaveBeenCalledWith("logo.example.test", { all: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("revalidates redirects before following them", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    vi.mocked(fetch).mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/internal" },
      }),
    );
    const { fetchInvoiceLogo } = await import("../services/invoiceLogo");

    await expect(fetchInvoiceLogo("https://logo.example.test/image.png")).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not buffer a response above the logo size cap", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.mocked(fetch).mockResolvedValue(
      new Response(Buffer.alloc(1), {
        status: 200,
        headers: { "content-length": String(512 * 1024 + 1) },
      }),
    );
    const { fetchInvoiceLogo } = await import("../services/invoiceLogo");

    await expect(fetchInvoiceLogo("https://logo.example.test/image.png")).resolves.toBeUndefined();
  });

  it("returns bytes for a small public HTTPS logo", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.mocked(fetch).mockResolvedValue(new Response(Buffer.from("png"), { status: 200 }));
    const { fetchInvoiceLogo } = await import("../services/invoiceLogo");

    await expect(fetchInvoiceLogo("https://logo.example.test/image.png")).resolves.toEqual(Buffer.from("png"));
  });
});

