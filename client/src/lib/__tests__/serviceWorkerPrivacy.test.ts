import { readFileSync } from "fs";
import path from "path";
import vm from "vm";
import { describe, expect, it } from "vitest";

/**
 * The service worker's PRV-07 rules (v1.2 Phase 5), run from client/public/sw.js
 * itself: it is plain script, so it is loaded into a sandbox with a stand-in
 * `self` and its top-level functions are read back.
 */
function loadServiceWorker(base = "/arcarna") {
  const source = readFileSync(path.resolve(__dirname, "../../../public/sw.js"), "utf8");
  const context: Record<string, any> = {
    self: { location: { pathname: `${base}/sw.js` }, addEventListener: () => {} },
    console,
    URL,
    Request: class {},
    Response: class {},
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  // Top-level consts do not land on the sandbox; the version is read from the source.
  const version = /const CACHE_VERSION = "(\d+)"/.exec(source)?.[1] ?? "0";
  return Object.assign(context, { CACHE_VERSION: version }) as unknown as {
    isPrivateApiPath: (p: string) => boolean;
    mayCacheApiResponse: (r: unknown) => boolean;
    CACHE_VERSION: string;
  };
}

function response(headers: Record<string, string>, ok = true) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { ok, headers: { get: (name: string) => lower[name.toLowerCase()] ?? null } };
}

describe("service worker: people's details are never cached (PRV-07)", () => {
  const sw = loadServiceWorker();

  it.each([
    "/arcarna/api/customers",
    "/arcarna/api/customers/abc",
    "/arcarna/api/customers/lookup-phone",
    "/arcarna/api/tick-customers",
    "/arcarna/api/credit/outstanding",
    "/arcarna/api/invoices",
    "/arcarna/api/invoices/abc/pdf",
    "/arcarna/api/whatsapp/conversations",
    "/arcarna/api/analytics/rfm/export",
    "/arcarna/api/analytics/rfm/customers",
    "/arcarna/api/analytics/top-customers",
    "/arcarna/api/cashier-analytics/export.csv",
    "/arcarna/api/reports/export",
    "/arcarna/api/orders/search",
    "/api/customers",
  ])("%s goes straight to the network", (p) => {
    expect(sw.isPrivateApiPath(p)).toBe(true);
  });

  it.each(["/arcarna/api/products", "/arcarna/api/stock-levels", "/arcarna/api/settings/receipt", "/arcarna/api/orders"])(
    "%s may still be kept for offline use",
    (p) => {
      expect(sw.isPrivateApiPath(p)).toBe(false);
    },
  );

  it("respects the server's no-store and never keeps a download", () => {
    expect(sw.mayCacheApiResponse(response({ "Cache-Control": "no-store, private" }))).toBe(false);
    expect(sw.mayCacheApiResponse(response({ "Cache-Control": "private, max-age=0" }))).toBe(false);
    expect(sw.mayCacheApiResponse(response({ "Content-Disposition": 'attachment; filename="x.csv"' }))).toBe(false);
    expect(sw.mayCacheApiResponse(response({}, false))).toBe(false);
    expect(sw.mayCacheApiResponse(response({ "Content-Type": "application/json" }))).toBe(true);
  });

  it("bumped its cache version so the old API cache is dropped on activate", () => {
    expect(Number(sw.CACHE_VERSION)).toBeGreaterThanOrEqual(10);
  });
});
