/**
 * The dev auth bypass decides how much access an unauthenticated caller gets
 * on a non-production server, and it used to answer "all of it".
 *
 * `tryDevAuthBypass` looks up DEV_AUTH_USER_ID in allowed_users. An id that is
 * not there defaulted to SUPER_ADMIN with `orgId: null`, and requireOrgContext
 * then honoured `x-org-id` — so on any bypass server an anonymous caller could
 * name any tenant and read it. It went unnoticed because every developer
 * machine has DEV_AUTH_USER_ID pointing at a real seeded user (the SessionStart
 * hook writes one), so the fallback never ran locally. CI, with no .env, hit it
 * immediately.
 *
 * Excluded from the unit run when DATABASE_URL is unset — see vitest.config.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { organizations, allowedUsers } from "@shared/schema";
import { tryDevAuthBypass } from "../auth/commonAuth";

const SUFFIX = `bypass-${Date.now()}`;
const KNOWN_USER = `${SUFFIX}-known`;

let orgId: string;
let savedEnv: { bypass?: string; devUser?: string; nodeEnv?: string };

/** Minimal Express-ish doubles: we only care about what the bypass decides. */
function fakeReq() {
  return { headers: {} } as any;
}
function fakeRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (b: unknown) => {
    res.body = b;
    return res;
  };
  return res;
}

/** Runs the bypass and reports whether it authenticated, and as what. */
async function runBypass() {
  const req = fakeReq();
  const res = fakeRes();
  let nextCalled = false;
  const handled = await tryDevAuthBypass(req, res, () => {
    nextCalled = true;
  });
  return { handled, nextCalled, user: req.user as undefined | { role: string; orgId: string | null } };
}

describe("dev auth bypass — how much an unauthenticated caller gets", () => {
  beforeAll(async () => {
    savedEnv = {
      bypass: process.env.DEV_AUTH_BYPASS,
      devUser: process.env.DEV_AUTH_USER_ID,
      nodeEnv: process.env.NODE_ENV,
    };
    process.env.DEV_AUTH_BYPASS = "1";
    process.env.NODE_ENV = "development";

    const [org] = await db
      .insert(organizations)
      .values({ name: `ZZ-BYPASS-ORG ${SUFFIX}` })
      .returning();
    orgId = org!.id;

    await db.insert(allowedUsers).values({
      replitUserId: KNOWN_USER,
      name: "Known Dev",
      email: `${KNOWN_USER}@seed.local`,
      role: "CASHIER",
      orgId,
    });
  });

  afterAll(async () => {
    await db.delete(allowedUsers).where(inArray(allowedUsers.replitUserId, [KNOWN_USER]));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    process.env.DEV_AUTH_BYPASS = savedEnv.bypass ?? "";
    if (savedEnv.devUser === undefined) delete process.env.DEV_AUTH_USER_ID;
    else process.env.DEV_AUTH_USER_ID = savedEnv.devUser;
    process.env.NODE_ENV = savedEnv.nodeEnv ?? "test";
  });

  beforeEach(() => {
    delete process.env.DEV_AUTH_USER_ID;
  });

  it("authenticates a known id with exactly that user's role and org", async () => {
    process.env.DEV_AUTH_USER_ID = KNOWN_USER;
    const { handled, nextCalled, user } = await runBypass();

    expect(handled, "a seeded id must be accepted").toBe(true);
    expect(nextCalled).toBe(true);
    expect(user?.role, "the bypass must not upgrade a cashier").toBe("CASHIER");
    expect(user?.orgId, "the bypass user must stay scoped to its own org").toBe(orgId);
  });

  it("refuses an id that is not in allowed_users, rather than granting super-admin", async () => {
    process.env.DEV_AUTH_USER_ID = `${SUFFIX}-does-not-exist`;
    const { handled, nextCalled, user } = await runBypass();

    // The regression: this used to return true with role SUPER_ADMIN and
    // orgId null — an anonymous caller that could select any tenant.
    expect(handled, "an unknown id must not be authenticated").toBe(false);
    expect(nextCalled, "the request must not continue as an authenticated user").toBe(false);
    expect(user, "no session user may be built for an unknown id").toBeUndefined();
  });

  it("defaults to the same refusal when DEV_AUTH_USER_ID is unset entirely", async () => {
    // Unset falls back to the literal id "dev-user", which is not seeded. This
    // is exactly the CI configuration that exposed the hole.
    const { handled, user } = await runBypass();

    expect(handled, 'the "dev-user" fallback must not be authenticated either').toBe(false);
    expect(user).toBeUndefined();
  });

  it("still bootstraps an install that has no users at all", async () => {
    // Something has to be able to create the first user on an empty database,
    // and it is the state the unseeded e2e/a11y CI jobs run in. Simulated
    // rather than performed: emptying allowed_users would destroy the dev
    // database other suites depend on.
    const { storage } = await import("../storage");
    const real = storage.countAllowedUsers.bind(storage);
    (storage as any).countAllowedUsers = async () => 0;
    try {
      process.env.DEV_AUTH_USER_ID = `${SUFFIX}-does-not-exist`;
      const { handled, user } = await runBypass();
      expect(handled, "an empty install must still be reachable").toBe(true);
      expect(user?.role, "bootstrap needs enough access to create the first user").toBe(
        "SUPER_ADMIN",
      );
    } finally {
      (storage as any).countAllowedUsers = real;
    }
  });

  it("stays off entirely when DEV_AUTH_BYPASS is not set", async () => {
    process.env.DEV_AUTH_BYPASS = "";
    try {
      process.env.DEV_AUTH_USER_ID = KNOWN_USER;
      const { handled, user } = await runBypass();
      expect(handled, "the bypass must do nothing when it is switched off").toBe(false);
      expect(user).toBeUndefined();
    } finally {
      process.env.DEV_AUTH_BYPASS = "1";
    }
  });
});
