/**
 * Ask arcarna (v1.2) against a real database. The Claude API is never called:
 * the route gets a mocked SDK client through setAskClientFactory.
 *
 * 1. Every tool, as every staff role, over a shop seeded with the role
 *    matrix's canaries (phone 07700 900123, canary@example.invalid, a £13.37
 *    cost, a saved address): no tool ever hands a cashier any of them, no
 *    tool hands anyone a customer's phone, email or address, and the tools
 *    above a role answer "outside your role" with no figures.
 * 2. The route: off and hidden with no ANTHROPIC_API_KEY; the answer streams;
 *    the audit row keeps who, role, tools, tokens and cost, never the answer,
 *    and the question scrubbed; the per-person rate limit; the monthly spend
 *    cap (admin-only settings, logged); the admin-only question log.
 *
 * Runs in CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CANARIES } from "@shared/accessPolicy";
import { REPORT_CATALOG } from "@shared/evidenceCatalog";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("Ask arcarna: tools inside the role, the route, the audit and the caps", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let tools: typeof import("../ask/tools");
  let engine: typeof import("../ask/engine");
  let routes: typeof import("../routes/ask");
  let app: express.Express;
  const orgId = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const ids = { locationId: "", productId: "", customerId: "", orderId: "" };
  const people = {
    CASHIER: { id: `ask-sam-${tag}`, name: "Sam Till", orgId: orgId as string | null },
    MANAGER: { id: `ask-alex-${tag}`, name: "Alex Boss", orgId: orgId as string | null },
    ADMIN: { id: `ask-ada-${tag}`, name: "Ada Admin", orgId: orgId as string | null },
    SUPER_ADMIN: { id: `ask-olive-${tag}`, name: "Olive Owner", orgId: null as string | null },
  } as const;
  type R = keyof typeof people;
  let actor: R = "CASHIER";
  const savedKey = process.env.ANTHROPIC_API_KEY;

  const ctxFor = (role: R) => ({ orgId, userId: people[role].id, role, locationId: ids.locationId });

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    tools = await import("../ask/tools");
    engine = await import("../ask/engine");
    routes = await import("../routes/ask");
    const s = schema;
    await db.insert(s.organizations).values({ id: orgId, name: "ZZ Ask arcarna Test", defaultTaxRate: "0" });
    await db.insert(s.allowedUsers).values(
      (Object.entries(people) as Array<[R, (typeof people)[R]]>).map(([role, p]) => ({
        replitUserId: p.id,
        authUserId: p.id,
        name: p.name,
        role: role as any,
        orgId: p.orgId,
      })),
    );
    const [loc] = await db
      .insert(s.locations)
      .values({ orgId, name: "Ask Shop", address: "1 Test Street", city: "Testville", state: "TS", zipCode: "TS1", phone: "0000000000", email: "shop@example.com", isDefault: 1, isActive: 1 })
      .returning();
    ids.locationId = loc.id;
    const [prod] = await db
      .insert(s.products)
      .values({ orgId, locationId: loc.id, name: "Canary Widget", productId: `ASK-${tag}`, defaultSalePrice: "20.00", minSalePrice: "18.00", costPrice: CANARIES.costPrice, stock: 2, stockLimit: 50 } as any)
      .returning();
    ids.productId = prod.id;
    await db.insert(s.productLocationStock).values({ orgId, productId: prod.id, locationId: loc.id, stock: 2 });
    const [cust] = await db
      .insert(s.customers)
      .values({ orgId, name: "Canary Customer", phone: CANARIES.phone, email: CANARIES.email, address: CANARIES.address })
      .returning();
    ids.customerId = cust.id;
    const [order] = await db
      .insert(s.orders)
      .values({
        orgId,
        locationId: loc.id,
        customerId: cust.id,
        total: "20.00",
        paymentMethod: "cash",
        status: "completed",
        settledAt: new Date(),
        settledTotal: "20.00",
        completedAt: new Date(),
        inputUserId: people.CASHIER.id,
        completedUserId: people.CASHIER.id,
        fulfilmentMethod: "delivery",
        deliveryAddress: "7 Delivered Row",
        deliveryPostcode: "CA1 1RY",
      } as any)
      .returning();
    ids.orderId = order.id;
    await db.insert(s.orderItems).values({ orgId, orderId: order.id, productId: prod.id, quantity: 1, unitPrice: "20.00", totalPrice: "20.00" });
    // A flag about the cashier whose summary carries the customer's number:
    // the manager may read the flag, never the number.
    await db.insert(s.exceptionReviews).values({
      orgId,
      kind: "refund",
      sourceId: randomUUID(),
      orderId: order.id,
      subjectUserId: people.CASHIER.id,
      subjectRole: "CASHIER",
      severity: "error",
      summary: `Refund £20.00 to Canary Customer (${CANARIES.phone}, ${CANARIES.email})`,
      amount: "20.00",
      state: "open",
    });

    const scoped: RequestHandler = (req: any, _res, next) => {
      const p = people[actor];
      req.orgContext = { orgId, locationId: ids.locationId, role: actor };
      req.user = { id: p.id, role: actor, claims: { sub: p.id } };
      next();
    };
    app = express();
    app.use(express.json());
    routes.registerAskRoutes(app, [scoped]);
  });

  afterAll(async () => {
    engine?.setAskClientFactory(null);
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
    if (!db) return;
    const { sql, inArray } = await import("drizzle-orm");
    for (const statement of [
      `DELETE FROM ask_questions WHERE org_id = '${orgId}'`,
      `DELETE FROM ask_settings WHERE org_id = '${orgId}'`,
      `DELETE FROM admin_audit_logs WHERE org_id = '${orgId}'`,
      `DELETE FROM exception_reviews WHERE org_id = '${orgId}'`,
      `DELETE FROM order_items WHERE org_id = '${orgId}'`,
      `DELETE FROM orders WHERE org_id = '${orgId}'`,
      `DELETE FROM inventory_movements WHERE org_id = '${orgId}'`,
      `DELETE FROM product_location_stock WHERE org_id = '${orgId}'`,
      `DELETE FROM products WHERE org_id = '${orgId}'`,
      `DELETE FROM customers WHERE org_id = '${orgId}'`,
      `DELETE FROM locations WHERE org_id = '${orgId}'`,
    ]) {
      try {
        await db.execute(sql.raw(statement));
      } catch (e) {
        console.warn("[askArcarna] cleanup", (e as Error).message);
      }
    }
    await db.delete(schema.allowedUsers).where(inArray(schema.allowedUsers.replitUserId, Object.values(people).map((p) => p.id)));
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgId]));
  });

  // -------------------------------------------------------------------------
  // 1. Tools
  // -------------------------------------------------------------------------

  type Leak = "phone" | "email" | "address" | "deliveredAddress" | "costPrice";
  function leaksIn(body: string): Leak[] {
    const found: Leak[] = [];
    const digits = body.replace(/[\s+-]/g, "");
    if (body.includes(CANARIES.phone) || digits.includes("7700900123")) found.push("phone");
    if (body.toLowerCase().includes(CANARIES.email)) found.push("email");
    if (body.includes(CANARIES.address)) found.push("address");
    if (body.includes("7 Delivered Row") || body.includes("CA1 1RY")) found.push("deliveredAddress");
    if (body.includes(CANARIES.costPrice)) found.push("costPrice");
    return found;
  }

  const refs = REPORT_CATALOG.filter((r) => r.status === "available").map((r) => r.ref);
  const today = new Date().toISOString().slice(0, 10);
  const calls: Array<[string, Record<string, unknown>]> = [
    ["list_evidence", {}],
    ...refs.map((ref) => ["run_evidence", { ref }] as [string, Record<string, unknown>]),
    ["my_performance", {}],
    ["my_performance", { from: "2026-01-01", to: today }],
    ["staff_performance", {}],
    ["needs_a_look", {}],
    ["needs_a_look", { state: "all" }],
    ["price_overrides", {}],
    ["would_have_flagged", {}],
    ["stock_levels", {}],
    ["stock_levels", { search: "canary" }],
    ["staff_targets", {}],
  ];
  const roles: R[] = ["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"];

  it.each(roles)("no tool gives %s a customer's phone, email or address, and no cost below manager", async (role) => {
    for (const [name, input] of calls) {
      const result = await tools.executeAskTool(name, input, ctxFor(role));
      const leaks = leaksIn(result.content);
      const allowed: Leak[] = role === "CASHIER" ? [] : ["costPrice"];
      expect(
        leaks.filter((l) => !allowed.includes(l)),
        `${role} ${name} ${JSON.stringify(input)} leaked`,
      ).toEqual([]);
    }
  });

  it("the sweep can see the canaries: a manager does get the cost through Weekly Margin", async () => {
    // Proves the seed reaches the tools, so a clean cashier sweep means something.
    const r = await tools.executeAskTool("run_evidence", { ref: "ARC-T2-001" }, ctxFor("MANAGER"));
    expect(leaksIn(r.content)).toContain("costPrice");
    const mine = await tools.executeAskTool("my_performance", {}, ctxFor("CASHIER"));
    expect(JSON.parse(mine.content).person.userId).toBe(people.CASHIER.id);
  });

  it("a cashier gets 'outside your role' from every Evidence tool, with no figures", async () => {
    const outside = ["staff_performance", "needs_a_look", "price_overrides", "would_have_flagged"];
    for (const name of outside) {
      const r = await tools.executeAskTool(name, {}, ctxFor("CASHIER"));
      expect(JSON.parse(r.content), name).toMatchObject({ outside_role: true });
      expect(r.evidence, name).toBeUndefined();
    }
    for (const ref of refs) {
      const r = await tools.executeAskTool("run_evidence", { ref }, ctxFor("CASHIER"));
      expect(JSON.parse(r.content), ref).toMatchObject({ outside_role: true });
    }
    const list = JSON.parse((await tools.executeAskTool("list_evidence", {}, ctxFor("CASHIER"))).content);
    expect(list.evidence).toEqual([]);
  });

  it("the Evidence exceptions hold: Staff Performance by ref and Would have flagged are admin and above", async () => {
    for (const [name, input] of [
      ["run_evidence", { ref: "ARC-T2-002" }],
      ["would_have_flagged", {}],
    ] as const) {
      expect(JSON.parse((await tools.executeAskTool(name, input, ctxFor("MANAGER"))).content)).toMatchObject({ outside_role: true });
      const admin = JSON.parse((await tools.executeAskTool(name, input, ctxFor("ADMIN"))).content);
      expect(admin.outside_role).toBeUndefined();
    }
    const managerList = JSON.parse((await tools.executeAskTool("list_evidence", {}, ctxFor("MANAGER"))).content);
    expect(managerList.evidence.map((e: any) => e.ref)).not.toContain("ARC-T2-002");
  });

  it("my performance is always the asker's own; the model cannot pick someone else", async () => {
    const r = await tools.executeAskTool("my_performance", { userId: people.MANAGER.id }, ctxFor("CASHIER"));
    expect(r.isError).toBe(true);
    const own = JSON.parse((await tools.executeAskTool("my_performance", {}, ctxFor("CASHIER"))).content);
    expect(own.person?.userId ?? people.CASHIER.id).toBe(people.CASHIER.id);
  });

  it("a manager reads the flag about the cashier, with the number taken out", async () => {
    const r = await tools.executeAskTool("needs_a_look", {}, ctxFor("MANAGER"));
    const body = JSON.parse(r.content);
    expect(body.byPerson[0]).toMatchObject({ name: "Sam Till", count: 1 });
    expect(r.content).toContain("[removed]");
    expect(r.evidence?.route).toBe("/needs-a-look");
  });

  it("stock levels answer every role from the allow-list, and link to Stock levels", async () => {
    const r = await tools.executeAskTool("stock_levels", { search: "canary" }, ctxFor("CASHIER"));
    const body = JSON.parse(r.content);
    expect(body.rows[0]).toMatchObject({ name: "Canary Widget", stock: 2 });
    expect(Object.keys(body.rows[0]).sort()).toEqual(["barcode", "name", "sku", "status", "stock", "stockLimit"]);
    expect(r.evidence?.route).toBe("/stock-levels");
  });

  it("an unknown tool or a bad input is an error result, not a crash", async () => {
    expect((await tools.executeAskTool("delete_everything", {}, ctxFor("SUPER_ADMIN"))).isError).toBe(true);
    expect((await tools.executeAskTool("run_evidence", { ref: "DROP TABLE" }, ctxFor("SUPER_ADMIN"))).isError).toBe(true);
    const tooLong = await tools.executeAskTool("staff_performance", { from: "2020-01-01", to: today }, ctxFor("ADMIN"));
    expect(tooLong.isError).toBe(true);
    expect(tooLong.content).not.toMatch(/select|relation|at \w+ \(/i);
  });

  // -------------------------------------------------------------------------
  // 2. The route
  // -------------------------------------------------------------------------

  function scriptedClient(reply: string, toolCall?: { name: string; input: Record<string, unknown> }) {
    return () => {
      let turn = 0;
      return {
        beta: {
          messages: {
            stream: () => {
              const first = turn++ === 0 && toolCall;
              const content = first
                ? [{ type: "tool_use", id: "tu_1", name: toolCall!.name, input: toolCall!.input }]
                : [{ type: "text", text: reply }];
              return {
                async *[Symbol.asyncIterator]() {
                  if (!first) yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: reply } };
                },
                async finalMessage() {
                  return {
                    content,
                    stop_reason: first ? "tool_use" : "end_turn",
                    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, iterations: null },
                  };
                },
              };
            },
          },
        },
      } as any;
    };
  }

  function events(text: string): any[] {
    return text
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => JSON.parse(chunk.slice(6)));
  }

  const post = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/ask")
      .send(body)
      .buffer(true)
      .parse((res, cb) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString("utf8")));
        res.on("end", () => cb(null, data));
      });

  beforeEach(() => {
    routes.askRateLimit.reset();
    engine.setAskClientFactory(null);
    actor = "CASHIER";
  });

  it("is off and hidden when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const status = await request(app).get("/api/ask/status");
    expect(status.body).toMatchObject({ enabled: false, suggestions: [] });
    const res = await request(app).post("/api/ask").send({ question: "How am I doing?" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("ASK_NOT_SET_UP");
    actor = "ADMIN";
    const settings = await request(app).get("/api/ask/settings");
    expect(settings.body).toMatchObject({ configured: false, model: "claude-opus-5", effort: "medium" });
    expect(settings.body.envLines[0]).toMatch(/^ANTHROPIC_API_KEY=/);
    expect(JSON.stringify(settings.body)).not.toMatch(/sk-test/);
  });

  it("streams the answer, and the audit row keeps tokens and cost but never the answer", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    engine.setAskClientFactory(scriptedClient("You have 2 Canary Widgets.", { name: "stock_levels", input: { search: "canary" } }));
    const status = await request(app).get("/api/ask/status");
    expect(status.body.enabled).toBe(true);
    expect(status.body.suggestions.length).toBeGreaterThan(0);
    expect(JSON.stringify(status.body)).not.toMatch(/sk-test/);

    const res = await post({ question: "Do we have canary widgets? Customer on 07700 900123 wants one", history: [] });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    const evs = events(res.body);
    expect(evs.filter((e) => e.type === "text").map((e) => e.text).join("")).toBe("You have 2 Canary Widgets.");
    expect(evs.find((e) => e.type === "evidence").items[0].route).toBe("/stock-levels");
    expect(evs[evs.length - 1]).toMatchObject({ type: "done", outcome: "answered" });

    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(schema.askQuestions).where(eq(schema.askQuestions.orgId, orgId));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      userId: people.CASHIER.id,
      role: "CASHIER",
      model: "claude-opus-5",
      inputTokens: 2000,
      outputTokens: 400,
      outcome: "answered",
      questionScrubbed: true,
      tools: ["stock_levels"],
    });
    expect(row.question).not.toMatch(/07700/);
    expect(Number(row.costGbp)).toBeGreaterThan(0);
    // The answer text is nowhere in the row.
    expect(JSON.stringify(row)).not.toMatch(/You have 2/);
  });

  it("refuses a question it cannot parse, and a body that claims a role", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect((await request(app).post("/api/ask").send({})).status).toBe(400);
    expect((await request(app).post("/api/ask").send({ question: "hi", role: "SUPER_ADMIN" })).status).toBe(400);
  });

  it("rate-limits one person, not the shop", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    engine.setAskClientFactory(scriptedClient("ok"));
    for (let i = 0; i < 10; i++) expect((await post({ question: `q${i}` })).status).toBe(200);
    const limited = await request(app).post("/api/ask").send({ question: "one more" });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("ASK_RATE_LIMITED");
    actor = "MANAGER";
    expect((await post({ question: "mine" })).status).toBe(200);
  });

  it("the monthly spend cap: admins set it (logged); once reached, no more questions", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    engine.setAskClientFactory(scriptedClient("ok"));
    actor = "MANAGER";
    expect((await request(app).put("/api/ask/settings").send({ monthlyCapGbp: 1, usdToGbp: 0.8 })).status).toBe(403);
    expect((await request(app).get("/api/ask/settings")).status).toBe(403);
    expect((await request(app).get("/api/ask/log")).status).toBe(403);

    actor = "ADMIN";
    const bad = await request(app).put("/api/ask/settings").send({ monthlyCapGbp: -5, usdToGbp: 0.8 });
    expect(bad.status).toBe(400);
    const saved = await request(app).put("/api/ask/settings").send({ monthlyCapGbp: 0.05, usdToGbp: 0.8 });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ monthlyCapGbp: 0.05, usdToGbp: 0.8 });
    const { and, eq } = await import("drizzle-orm");
    const audit = await db
      .select()
      .from(schema.adminAuditLogs)
      .where(and(eq(schema.adminAuditLogs.orgId, orgId), eq(schema.adminAuditLogs.action, "ask.settings.saved")));
    expect(audit).toHaveLength(1);

    // Spend already recorded this month is over 5p: the next question is refused before any call.
    await db.insert(schema.askQuestions).values({ orgId, userId: people.ADMIN.id, role: "ADMIN", model: "claude-opus-5", costGbp: "0.0600", outcome: "answered" });
    actor = "CASHIER";
    const capped = await request(app).post("/api/ask").send({ question: "How am I doing?" });
    expect(capped.status).toBe(429);
    expect(capped.body.code).toBe("ASK_SPEND_CAP");

    // A cap of 0 pauses Ask arcarna altogether.
    actor = "ADMIN";
    await request(app).put("/api/ask/settings").send({ monthlyCapGbp: 0, usdToGbp: 0.8 });
    actor = "CASHIER";
    expect((await request(app).post("/api/ask").send({ question: "hi" })).status).toBe(429);

    actor = "ADMIN";
    const view = await request(app).get("/api/ask/settings");
    expect(view.body).toMatchObject({ configured: true, monthlyCapGbp: 0, usdToGbp: 0.8 });
    expect(view.body.spentThisMonthGbp).toBeGreaterThan(0);
    await request(app).put("/api/ask/settings").send({ monthlyCapGbp: 25, usdToGbp: 0.79 });
  });

  it("the question log is for admins: who, role, tools, tokens and the scrubbed question", async () => {
    actor = "ADMIN";
    const res = await request(app).get("/api/ask/log");
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: any) => r.tools.includes("stock_levels"));
    expect(row).toMatchObject({ name: "Sam Till", role: "CASHIER", questionScrubbed: true });
    expect(row.question).not.toMatch(/07700/);
    expect(leaksIn(JSON.stringify(res.body))).toEqual([]);
  });

  /** A client whose turns are scripted per call: usage from message_start, an optional gate. */
  function gatedClient(turns: Array<{ usage: Record<string, number>; toolCall?: boolean; gate?: Promise<void>; onStart?: () => void }>) {
    const calls = { n: 0 };
    const factory = () =>
      ({
        beta: {
          messages: {
            stream: () => {
              const t = turns[calls.n++];
              const usage = { cache_read_input_tokens: 0, cache_creation_input_tokens: 0, iterations: null, ...t.usage };
              const content = t.toolCall
                ? [{ type: "tool_use", id: `tu_${calls.n}`, name: "stock_levels", input: {} }]
                : [{ type: "text", text: "ok" }];
              return {
                async *[Symbol.asyncIterator]() {
                  yield { type: "message_start", message: { usage: { ...usage, output_tokens: 1 } } };
                  t.onStart?.();
                  if (t.gate) await t.gate;
                  if (!t.toolCall) yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } };
                },
                async finalMessage() {
                  return { content, stop_reason: t.toolCall ? "tool_use" : "end_turn", usage };
                },
              };
            },
          },
        },
      }) as any;
    return { factory, calls };
  }

  async function capJustAboveSpend(extraGbp: number): Promise<void> {
    actor = "ADMIN";
    const view = await request(app).get("/api/ask/settings");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(schema.askQuestions).where(eq(schema.askQuestions.orgId, orgId));
    const spent = rows.reduce((sum: number, r: any) => sum + Number(r.costGbp), 0);
    expect(view.status).toBe(200);
    await request(app).put("/api/ask/settings").send({ monthlyCapGbp: Math.ceil((spent + extraGbp) * 100) / 100, usdToGbp: 0.8 });
    actor = "CASHIER";
  }

  it("the spend cap counts questions still being answered, not only finished ones", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    await capJustAboveSpend(0.05);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started = false;
    // 100k input tokens at $5/MTok = $0.50 = £0.40: well past the 5p headroom.
    const { factory } = gatedClient([{ usage: { input_tokens: 100_000, output_tokens: 10 }, gate, onStart: () => (started = true) }]);
    engine.setAskClientFactory(factory);
    const first = post({ question: "How am I doing?" }).then((r) => r);
    for (let i = 0; i < 200 && !started; i++) await new Promise((r) => setTimeout(r, 10));
    expect(started).toBe(true);
    expect(routes.askInFlightCount(orgId)).toBe(1);

    const second = await request(app).post("/api/ask").send({ question: "And this week?" });
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("ASK_SPEND_CAP");

    release();
    expect((await first).status).toBe(200);
    expect(routes.askInFlightCount(orgId)).toBe(0);
    actor = "ADMIN";
    await request(app).put("/api/ask/settings").send({ monthlyCapGbp: 25, usdToGbp: 0.79 });
  });

  it("the spend cap is checked again between tool rounds", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    await capJustAboveSpend(0.05);
    const { factory, calls } = gatedClient([
      { usage: { input_tokens: 100_000, output_tokens: 10 }, toolCall: true },
      { usage: { input_tokens: 10, output_tokens: 10 } },
    ]);
    engine.setAskClientFactory(factory);
    const res = await post({ question: "Which products are running low?" });
    expect(res.status).toBe(200);
    const evs = events(res.body);
    expect(evs.filter((e) => e.type === "text").map((e) => e.text).join("")).toMatch(/spending limit/);
    expect(evs[evs.length - 1]).toMatchObject({ type: "done", outcome: "cut_short" });
    // The second round was never sent.
    expect(calls.n).toBe(1);
    actor = "ADMIN";
    await request(app).put("/api/ask/settings").send({ monthlyCapGbp: 25, usdToGbp: 0.79 });
  });
});
