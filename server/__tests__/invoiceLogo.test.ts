import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupAddress } from "node:dns";
import { isPrivateOrReservedIp, loadInvoiceLogo, type InvoiceLogoFetchOptions } from "../services/invoiceLogo";

const enabledOrg = (logoUrl: string) => ({ invoiceLogoEnabled: true, logoUrl });
const publicLookupAddress: LookupAddress = { address: "93.184.216.34", family: 4 };
const lookupPublic: NonNullable<InvoiceLogoFetchOptions["lookup"]> = async () => [publicLookupAddress];

function successfulRequest(body = Buffer.from("png")): NonNullable<InvoiceLogoFetchOptions["request"]> {
  return vi.fn(async () => ({
    statusCode: 200,
    headers: { "content-type": "image/png" },
    body,
  }));
}

describe("invoice logo fetching", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches a small HTTPS logo from a public host", async () => {
    const request = successfulRequest();

    const logo = await loadInvoiceLogo(enabledOrg("https://cdn.example.com/logo.png"), {
      lookup: lookupPublic,
      request,
    });

    expect(logo?.toString()).toBe("png");
    expect(request).toHaveBeenCalledWith(
      new URL("https://cdn.example.com/logo.png"),
      expect.objectContaining({ lookupAddress: publicLookupAddress }),
    );
  });

  it("does not request non-HTTPS logo URLs", async () => {
    const request = successfulRequest();

    const logo = await loadInvoiceLogo(enabledOrg("http://example.com/logo.png"), {
      lookup: lookupPublic,
      request,
    });

    expect(logo).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it("does not request literal private or loopback IP addresses", async () => {
    const request = successfulRequest();

    const logo = await loadInvoiceLogo(enabledOrg("https://127.0.0.1/logo.png"), {
      lookup: lookupPublic,
      request,
    });

    expect(logo).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it("does not request hostnames that resolve to private addresses", async () => {
    const request = successfulRequest();
    const lookupPrivate: NonNullable<InvoiceLogoFetchOptions["lookup"]> = async () => [
      { address: "169.254.169.254", family: 4 },
    ];

    const logo = await loadInvoiceLogo(enabledOrg("https://metadata.example/logo.png"), {
      lookup: lookupPrivate,
      request,
    });

    expect(logo).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it("revalidates redirects before following them", async () => {
    const request: NonNullable<InvoiceLogoFetchOptions["request"]> = vi.fn(async () => ({
      statusCode: 302,
      headers: { location: "https://127.0.0.1/latest/meta-data" },
      body: Buffer.alloc(0),
    }));

    const logo = await loadInvoiceLogo(enabledOrg("https://cdn.example.com/logo.png"), {
      lookup: lookupPublic,
      request,
    });

    expect(logo).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("drops responses larger than the invoice logo size cap", async () => {
    const request = successfulRequest(Buffer.alloc(6));

    const logo = await loadInvoiceLogo(enabledOrg("https://cdn.example.com/logo.png"), {
      lookup: lookupPublic,
      request,
      maxBytes: 5,
    });

    expect(logo).toBeUndefined();
  });
});

describe("private and reserved IP detection", () => {
  it("blocks local, private, metadata, and documentation ranges", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("10.0.0.5")).toBe(true);
    expect(isPrivateOrReservedIp("172.20.0.5")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.5")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("203.0.113.10")).toBe(true);
    expect(isPrivateOrReservedIp("::1")).toBe(true);
    expect(isPrivateOrReservedIp("fd00::1")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedIp("2606:4700:4700::1111")).toBe(false);
  });
});
