/**
 * v1.2.1 sec sweep — failing repros for findings that live below the HTTP
 * layer (or that the loopback-only test server cannot reach end to end).
 *
 * Each test states the behaviour the fix must produce. They are expected to
 * FAIL on the v1.2 code (d31d2e0) and pass once the finding is fixed. No DB:
 * `../db` and `../storage` are mocked so this runs in the no-DATABASE_URL job.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({
  storage: {
    getUserRoleAndOrg: vi.fn(async () => ({ role: "SUPER_ADMIN", orgId: null })),
  },
}));

// ---------------------------------------------------------------------------
// SEC-XFF: the "localhost only" impersonation guard trusts req.ip, which
// Express derives from X-Forwarded-For under `trust proxy: 1`. A caller on
// another machine sends `X-Forwarded-For: 127.0.0.1` and is treated as local.
// Reproduced live against the running server on 192.0.2.2:5122: without the
// header 401, with it 200 as seed-admin.
// ---------------------------------------------------------------------------
describe("SEC-XFF: test impersonation must be judged on the socket, not X-Forwarded-For", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.PHASE2D_TEST = "1";
    process.env.PHASE2D_TEST_SECRET = "s3cret";
    process.env.NODE_ENV = "development";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  function fakeReq(ip: string, remoteAddress: string) {
    return {
      ip,
      socket: { remoteAddress },
      headers: {
        "x-test-replit-user-id": "seed-super-admin",
        "x-test-secret": "s3cret",
        "x-forwarded-for": "127.0.0.1",
      },
    } as any;
  }

  it("refuses a remote socket that claims 127.0.0.1 through X-Forwarded-For", async () => {
    const { tryPhase2dTestAuth } = await import("../auth/commonAuth");
    const next = vi.fn();
    const res = { status: vi.fn(() => res), json: vi.fn() } as any;
    // req.ip is what Express computes from XFF with trust proxy 1; the real
    // peer is 192.0.2.2 (a non-loopback interface).
    const handled = await tryPhase2dTestAuth(fakeReq("127.0.0.1", "192.0.2.2"), res, next);
    expect(handled, "a non-loopback peer must not be impersonated").toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  it("control: a genuine loopback peer is still accepted", async () => {
    const { tryPhase2dTestAuth } = await import("../auth/commonAuth");
    const next = vi.fn();
    const res = { status: vi.fn(() => res), json: vi.fn() } as any;
    const handled = await tryPhase2dTestAuth(fakeReq("127.0.0.1", "127.0.0.1"), res, next);
    expect(handled).toBe(true);
    expect(next).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SEC-LOGPII: the legacy domain engine's audit port writes every
// CustomerUpdated change set to stdout, including phone, email and address in
// clear. Reproduced live: PUT /api/customers/:id {"phone":"07700900333",
// "address":"14 Leak Street"} as seed-admin printed
// {"kind":"domain_audit","event":"CustomerUpdated","payload":{...,"changes":
// {"phone":"07700900333","address":"14 Leak Street"}}} to the server log.
// ---------------------------------------------------------------------------
describe("SEC-LOGPII: customer contact never reaches the application log", () => {
  it("AuditPortDrizzle.log drops phone, email and address from what it prints", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    try {
      const { AuditPortDrizzle } = await import("../../apps/server/src/db/analytics_audit");
      await AuditPortDrizzle.log("CustomerUpdated", {
        customerId: "00000000-0000-4000-8000-000000000001",
        changes: {
          name: "Fictional Person",
          phone: "07700900333",
          email: "fictional@example.invalid",
          address: "14 Example Street",
        },
      });
    } finally {
      spy.mockRestore();
    }
    const out = lines.join("\n");
    expect(out).not.toContain("07700900333");
    expect(out).not.toContain("fictional@example.invalid");
    expect(out).not.toContain("14 Example Street");
  });
});

// ---------------------------------------------------------------------------
// SEC-UNSUBKEY: receipt unsubscribe links are HMAC-signed with
// RECEIPT_SIGNING_SECRET, falling back to the public constant
// "dev-receipt-signing-change-me". validateProductionEnv does not require the
// variable, so a production box without it accepts forged unsubscribe tokens.
// ---------------------------------------------------------------------------
describe("SEC-UNSUBKEY: production must not sign with the built-in receipt secret", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("validateProductionEnv refuses to start without RECEIPT_SIGNING_SECRET", async () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://x";
    process.env.SESSION_SECRET = "x".repeat(40);
    process.env.DEV_AUTH_BYPASS = "0";
    process.env.AUTH_PROVIDER = "clerk";
    process.env.CLERK_SECRET_KEY = "sk_test_x";
    process.env.CLERK_PUBLISHABLE_KEY = "pk_test_x";
    process.env.CLERK_ACCOUNTS_URL = "https://accounts.example.invalid";
    delete process.env.RECEIPT_SIGNING_SECRET;
    const { validateProductionEnv } = await import("../validateProductionEnv");
    expect(() => validateProductionEnv()).toThrow(/RECEIPT_SIGNING_SECRET/);
  });

  it("a token signed with the public fallback is not accepted in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.RECEIPT_SIGNING_SECRET;
    const crypto = await import("node:crypto");
    const payload = "00000000-0000-4000-8000-000000000001|someone@example.invalid";
    const sig = crypto.createHmac("sha256", "dev-receipt-signing-change-me").update(payload).digest("base64url");
    const forged = `${Buffer.from(payload).toString("base64url")}.${sig}`;
    const { verifyUnsubscribeToken } = await import("../services/receiptSigning");
    let verdict: unknown = null;
    try {
      verdict = verifyUnsubscribeToken(forged);
    } catch {
      verdict = null; // throwing (no secret configured) is an acceptable fix
    }
    expect(verdict).toBeNull();
  });
});
