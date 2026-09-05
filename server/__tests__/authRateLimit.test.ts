import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { isAuthStatePath, mountTieredApiRateLimits } from "../security";

/**
 * The auth limiter allows 20 requests a minute. That is a brute-force budget:
 * right for sign-in and bootstrap, wrong for the endpoint the SPA calls on
 * every single page load to ask whether it is still signed in.
 *
 * Getting this wrong is not a slow app. A shop runs several tills behind one
 * public IP, express-rate-limit keys on that IP, and the client cannot tell
 * "the server would not answer" from "you are not signed in" — so tripping the
 * limit takes every route away and answers "this route does not exist" on
 * every page until the window rolls over. It was found exactly that way, in
 * CI, where a run of page loads exhausted twenty in a minute.
 */
function appWithLimits() {
  const app = express();
  mountTieredApiRateLimits(app as any, false);
  app.get("/api/auth/user", (_req, res) => res.json({ ok: true }));
  app.get("/api/auth/bootstrap", (_req, res) => res.json({ ok: true }));
  return app;
}

async function statusesFor(path: string, times: number): Promise<number[]> {
  const app = appWithLimits();
  const seen: number[] = [];
  for (let i = 0; i < times; i += 1) {
    const res = await request(app).get(path);
    seen.push(res.status);
  }
  return seen;
}

describe("auth rate limiting", () => {
  it("classifies session reads apart from credential attempts", () => {
    expect(isAuthStatePath("/api/auth/user")).toBe(true);
    expect(isAuthStatePath("/api/auth/runtime")).toBe(true);

    expect(isAuthStatePath("/api/auth/bootstrap")).toBe(false);
    expect(isAuthStatePath("/api/auth/approval-status")).toBe(false);
    expect(isAuthStatePath("/api/auth")).toBe(false);
    expect(isAuthStatePath("/api/orders")).toBe(false);
  });

  it("does not throttle the session read at twenty a minute", async () => {
    // Well past the auth budget, and nowhere near the general one. A tablet
    // reloading a few times, or three tills doing ordinary work, reaches this.
    const statuses = await statusesFor("/api/auth/user", 30);
    expect(statuses.filter((s) => s === 429)).toEqual([]);
  });

  it("still throttles credential attempts at twenty a minute", async () => {
    const statuses = await statusesFor("/api/auth/bootstrap", 30);
    expect(
      statuses.filter((s) => s === 429).length,
      "the brute-force budget must still apply to endpoints with something to guess at",
    ).toBeGreaterThan(0);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
  });
});
