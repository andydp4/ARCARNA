import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const captureMessage = vi.fn();
vi.mock("@sentry/node", () => ({ captureMessage, captureException: vi.fn() }));

import {
  isDatabaseError,
  looksLikeDatabaseErrorText,
  safeErrorMessage,
  scrubErrorResponseBody,
  sendServerError,
} from "../lib/errorScrub";
import { httpLogMiddleware, pathTemplate, redactPii, summariseErrorBody } from "../httpLog";
import { requestIdMiddleware } from "../requestId";
import { isMissingStaticFilePath, serveStatic } from "../static";
// @ts-expect-error — plain .mjs CI script, no type declarations
import { findEchoes } from "../../scripts/audit-db-error-echo.mjs";

const DRIZZLE_TEXT =
  'Failed query: insert into "customers" ("name", "phone") values ($1, $2)\nparams: Jane Canary,07700 900123';

describe("database error detection", () => {
  it("recognises drizzle and postgres error text", () => {
    expect(looksLikeDatabaseErrorText(DRIZZLE_TEXT)).toBe(true);
    expect(looksLikeDatabaseErrorText('relation "audit_logs" does not exist')).toBe(true);
    expect(looksLikeDatabaseErrorText('duplicate key value violates unique constraint "x_pkey"')).toBe(true);
    expect(isDatabaseError({ code: "23505", severity: "ERROR", message: "boom" })).toBe(true);
    expect(isDatabaseError({ name: "DrizzleQueryError", message: "x" })).toBe(true);
  });

  it("leaves ordinary till messages alone", () => {
    expect(looksLikeDatabaseErrorText("Payments add up to £10.00 but the order is £12.00")).toBe(false);
    expect(looksLikeDatabaseErrorText("Please select a customer from the list")).toBe(false);
    expect(safeErrorMessage(new Error("Gift card has expired"), "Failed")).toBe("Gift card has expired");
    expect(safeErrorMessage(new Error(DRIZZLE_TEXT), "Failed to create order")).toBe("Failed to create order");
  });

  it("scrubs error bodies and adds the reference", () => {
    const out = scrubErrorResponseBody({ message: DRIZZLE_TEXT, code: "X" }, "req-1") as Record<string, unknown>;
    expect(out.message).toBe("Something went wrong on our side. Reference: req-1");
    expect(out.code).toBe("X");
    expect(out.requestId).toBe("req-1");
    const clean = { message: "Not found" };
    expect(scrubErrorResponseBody(clean, "r")).toBe(clean);
  });
});

describe("request log", () => {
  it("templates ids out of paths", () => {
    expect(pathTemplate("/arcarna/api/orders/3f1c2a9e-1b2c-4d5e-8f90-123456789abc/refund")).toBe(
      "/arcarna/api/orders/:id/refund",
    );
    expect(pathTemplate("/api/customers/42")).toBe("/api/customers/:id");
    expect(pathTemplate("/api/products/top-sellers")).toBe("/api/products/top-sellers");
  });

  it("redacts contact details from logged messages", () => {
    const s = redactPii("Jane canary@example.invalid 07700 900123 SW1A 1AA");
    expect(s).not.toMatch(/canary@|07700|SW1A/);
    expect(summariseErrorBody({ code: "E", message: "call 07700 900123" })).toEqual({ code: "E", message: "call [phone]" });
  });
});

describe("httpLogMiddleware", () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const prevDsn = process.env.SENTRY_DSN;

  beforeAll(() => {
    process.env.SENTRY_DSN = "https://public@example.invalid/1";
  });
  afterAll(() => {
    if (prevDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = prevDsn;
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
  afterEach(() => {
    logSpy.mockClear();
    captureMessage.mockClear();
  });

  function app() {
    const a = express();
    a.use(requestIdMiddleware);
    a.use(httpLogMiddleware);
    a.get("/api/customers", (_req, res) => {
      res.json([{ name: "Jane Canary", phone: "07700 900123", email: "canary@example.invalid" }]);
    });
    a.get("/api/leaky", (_req, res) => {
      res.status(500).json({ message: DRIZZLE_TEXT });
    });
    a.get("/api/fixed", (req, res) => {
      sendServerError(res, new Error(DRIZZLE_TEXT), "Failed to load");
    });
    return a;
  }

  it("never writes response bodies to the log", async () => {
    await request(app()).get("/api/customers").expect(200);
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain('"path":"/api/customers"');
    expect(logged).not.toMatch(/Canary|07700|canary@/);
    expect(logged).not.toContain("responseSnippet");
  });

  it("scrubs database text from a route's own 500 and reports it to Sentry", async () => {
    const res = await request(app()).get("/api/leaky").expect(500);
    expect(JSON.stringify(res.body)).not.toMatch(/Failed query|07700|customers/);
    expect(res.body.message).toMatch(/^Something went wrong on our side\. Reference: /);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    await vi.waitFor(() => expect(captureMessage).toHaveBeenCalledOnce());
    const [name, ctx] = captureMessage.mock.calls[0];
    expect(name).toBe("http_5xx");
    expect(ctx.tags).toMatchObject({ path_template: "/api/leaky", status: "500" });
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toMatch(/Failed query|07700/);
  });

  it("sendServerError sends the fallback and the reference, never the error", async () => {
    const res = await request(app()).get("/api/fixed").expect(500);
    expect(res.body).toEqual({ message: "Failed to load", requestId: res.headers["x-request-id"] });
  });
});

describe("missing app files", () => {
  let dir: string;
  const cwd = process.cwd();
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-static-"));
    fs.mkdirSync(path.join(dir, "dist", "public", "assets"), { recursive: true });
    fs.writeFileSync(path.join(dir, "dist", "public", "index.html"), "<html>shell</html>");
    fs.writeFileSync(path.join(dir, "dist", "public", "assets", "app-new.js"), "console.log(1)");
    process.chdir(dir);
  });
  afterAll(() => {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("classifies file paths vs SPA routes", () => {
    expect(isMissingStaticFilePath("/assets/pos-OLDHASH.js")).toBe(true);
    expect(isMissingStaticFilePath("/logo.png")).toBe(true);
    expect(isMissingStaticFilePath("/reports/daily-sales")).toBe(false);
    expect(isMissingStaticFilePath("/open-orders/abc/refund")).toBe(false);
  });

  it("answers a stale chunk with 404, not the app shell", async () => {
    const a = express();
    serveStatic(a, "/");
    await request(a).get("/assets/app-new.js").expect(200);
    const stale = await request(a).get("/assets/pos-OLDHASH.js").expect(404);
    expect(stale.text).not.toContain("<html>");
    const route = await request(a).get("/reports/daily-sales").expect(200);
    expect(route.text).toContain("shell");
  });
});

describe("audit-db-error-echo", () => {
  it("flags a 5xx that echoes the error, across lines", () => {
    expect(findEchoes(`res.status(500).json({ message: error.message || "x" });`)).toHaveLength(1);
    expect(
      findEchoes(`res.status(503).json({\n ok: false,\n message: e instanceof Error ? e.message : "y",\n});`),
    ).toHaveLength(1);
    expect(findEchoes(`res.status(500).json({ error: String(err) });`)).toHaveLength(1);
  });

  it("allows fixed messages and 4xx", () => {
    expect(findEchoes(`res.status(500).json({ message: "Failed" });`)).toHaveLength(0);
    expect(findEchoes(`res.status(400).json({ message: error.message });`)).toHaveLength(0);
  });
});
