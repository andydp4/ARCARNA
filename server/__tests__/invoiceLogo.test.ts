import { describe, expect, it, vi } from "vitest";
import {
  fetchInvoiceLogo,
  isPubliclyRoutableIp,
  loadInvoiceLogo,
} from "../services/invoiceLogo";

const publicLookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

describe("invoice logo fetching", () => {
  it("loads a bounded HTTPS logo from a public host", async () => {
    const body = Buffer.from("logo-bytes");
    const fetchImpl = vi.fn(async () => new Response(body));

    const logo = await fetchInvoiceLogo("https://example.com/logo.png", {
      fetchImpl,
      lookup: publicLookup,
    });

    expect(logo).toEqual(body);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.com/logo.png",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("does not fetch non-HTTPS or link-local metadata URLs", async () => {
    const fetchImpl = vi.fn(async () => new Response("unexpected"));

    await expect(
      fetchInvoiceLogo("http://example.com/logo.png", { fetchImpl, lookup: publicLookup }),
    ).resolves.toBeUndefined();
    await expect(
      fetchInvoiceLogo("https://169.254.169.254/latest/meta-data", { fetchImpl, lookup: publicLookup }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects hostnames that resolve to private addresses before fetching", async () => {
    const lookup = vi.fn(async () => [{ address: "10.0.0.5", family: 4 }]);
    const fetchImpl = vi.fn(async () => new Response("unexpected"));

    const logo = await fetchInvoiceLogo("https://internal.example/logo.png", { fetchImpl, lookup });

    expect(logo).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates redirects before following them", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/logo.png" },
      }),
    );

    const logo = await fetchInvoiceLogo("https://example.com/logo.png", {
      fetchImpl,
      lookup: publicLookup,
    });

    expect(logo).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("drops logos larger than the configured byte cap", async () => {
    const fetchImpl = vi.fn(async () => new Response(Buffer.from("too-large")));

    const logo = await fetchInvoiceLogo("https://example.com/logo.png", {
      fetchImpl,
      lookup: publicLookup,
      maxBytes: 4,
    });

    expect(logo).toBeUndefined();
  });

  it("aborts slow logo responses", async () => {
    const fetchImpl = vi.fn(
      (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const logo = await fetchInvoiceLogo("https://example.com/logo.png", {
      fetchImpl,
      lookup: publicLookup,
      timeoutMs: 1,
    });

    expect(logo).toBeUndefined();
  });

  it("skips disabled invoice logos without touching the network", async () => {
    const fetchImpl = vi.fn(async () => new Response("unexpected"));

    const logo = await loadInvoiceLogo(
      { invoiceLogoEnabled: false, logoUrl: "https://example.com/logo.png" },
      { fetchImpl, lookup: publicLookup },
    );

    expect(logo).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies private and public IP ranges used by the URL guard", () => {
    expect(isPubliclyRoutableIp("93.184.216.34")).toBe(true);
    expect(isPubliclyRoutableIp("10.1.2.3")).toBe(false);
    expect(isPubliclyRoutableIp("192.168.0.1")).toBe(false);
    expect(isPubliclyRoutableIp("::1")).toBe(false);
    expect(isPubliclyRoutableIp("fc00::1")).toBe(false);
  });
});
