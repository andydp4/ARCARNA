/**
 * What's New and the Operations tour are remembered per ACCOUNT (migration
 * 069), not per browser — the owner saw them "every time you log in or switch
 * device" while the flag lived only in localStorage.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import { userUiSeen } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("per-account seen markers", () => {
  let db: (typeof import("../db"))["db"];
  let svc: typeof import("../services/uiSeen");
  let registerUiSeenRoutes: (typeof import("../routes/uiSeen"))["registerUiSeenRoutes"];
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    ({ db } = await import("../db"));
    svc = await import("../services/uiSeen");
    ({ registerUiSeenRoutes } = await import("../routes/uiSeen"));
    alice = `test-alice-${randomUUID()}`;
    bob = `test-bob-${randomUUID()}`;
  });

  afterEach(async () => {
    await db.delete(userUiSeen).where(inArray(userUiSeen.userId, [alice, bob]));
  });

  function appAs(userId: string | null) {
    const app = express();
    app.use(express.json());
    registerUiSeenRoutes(app, (req: any, res, next) => {
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      req.user = { claims: { sub: userId } };
      next();
    });
    return app;
  }

  it("records a key against the account, once, however many times it is sent", async () => {
    await request(appAs(alice)).post("/api/me/seen").send({ keys: ["whatsNew:1.1.0"] }).expect(200);
    await request(appAs(alice)).post("/api/me/seen").send({ keys: ["whatsNew:1.1.0", "whatsNew:1.1.0"] }).expect(200);
    expect(await svc.listSeenUiKeys(alice)).toEqual(["whatsNew:1.1.0"]);
  });

  it("keeps one person's markers to themselves", async () => {
    await svc.markUiKeysSeen(alice, ["opsTour:1.1.0"]);
    expect(await svc.listSeenUiKeys(bob)).toEqual([]);
  });

  it("refuses malformed keys and unauthenticated callers", async () => {
    await request(appAs(alice)).post("/api/me/seen").send({ keys: ["not a key"] }).expect(400);
    await request(appAs(alice)).post("/api/me/seen").send({ keys: [] }).expect(400);
    await request(appAs(null)).post("/api/me/seen").send({ keys: ["whatsNew:1.1.0"] }).expect(401);
    expect(await svc.listSeenUiKeys(alice)).toEqual([]);
  });
});
