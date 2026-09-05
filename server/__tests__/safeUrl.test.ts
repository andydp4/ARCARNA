import { describe, it, expect } from "vitest";
import { assertPublicHttpsUrl, isBlockedAddress } from "../lib/safeUrl";

/**
 * The outbound webhook path posts order payloads to a URL a tenant admin
 * supplies, and its only check was `url.startsWith("https://")` — a string test
 * every address below satisfies. This guard existed in the codebase already but
 * was module-private to invoiceLogo.ts, so the webhook sender never used it.
 *
 * Blind SSRF rather than a read primitive: delivery is fire-and-forget and the
 * response is discarded, so nothing comes back to the caller. It still let a
 * customer's admin make the server probe the host's own network, and hold a
 * socket open indefinitely while doing it.
 */
describe("assertPublicHttpsUrl", () => {
  it.each([
    ["https://127.0.0.1:5000/hook", "loopback — the app's own port"],
    ["https://localhost/hook", "loopback by name"],
    ["https://169.254.169.254/latest/meta-data/", "cloud metadata service"],
    ["https://10.0.0.5/hook", "RFC1918 class A"],
    ["https://172.16.4.2/hook", "RFC1918 class B"],
    ["https://192.168.1.1/hook", "RFC1918 class C"],
    ["https://[::1]/hook", "IPv6 loopback"],
    ["http://example.com/hook", "plain http"],
    ["https://user:pass@example.com/hook", "credentials embedded in the URL"],
    ["not-a-url", "unparseable"],
  ])("rejects %s (%s)", async (url) => {
    expect(await assertPublicHttpsUrl(url)).toBeNull();
  });

  it("accepts a public https URL", async () => {
    const result = await assertPublicHttpsUrl("https://example.com/hook");
    expect(result).not.toBeNull();
    expect(result?.hostname).toBe("example.com");
  });

  it("blocks an IPv4-mapped IPv6 loopback, which a naive string check misses", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("treats a non-IP string as blocked rather than allowed", () => {
    // Fail closed: anything the resolver hands back that is not a recognisable
    // address must not be assumed routable.
    expect(isBlockedAddress("nonsense")).toBe(true);
  });
});
