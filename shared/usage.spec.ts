import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { API_ROUTE_WORDS } from "./apiRouteWords";
import {
  apiRouteShape,
  daysOfData,
  emptyTotals,
  fixCheckLine,
  hasEnoughData,
  isFrictionCall,
  normaliseStudyWindow,
  normaliseUsageEvent,
  painLeaderboard,
  pickTopFive,
  scoreScreen,
  scrubMessageTitle,
  studyActiveOn,
  studyWindowProblem,
  topFiveLine,
  usageBatchSchema,
  weeklyAllowed,
  type ScreenTotals,
} from "./usage";

/** Our own usage record and Friction Truths (v1.2 Phase 8B/8C): the shared rules. */

const H = 3_600_000;
const t = (screen: string, over: Partial<ScreenTotals> = {}): ScreenTotals => ({ ...emptyTotals(screen), ...over });

describe("what may be stored", () => {
  it("keeps a message title and cuts out names, numbers, amounts and references", () => {
    expect(scrubMessageTitle("Order failed")).toBe("Order failed");
    expect(scrubMessageTitle("Can't find it")).toBe("Can't find it");
    expect(scrubMessageTitle("Refunded — order AB12 for Jane Smith")).toBe("Refunded");
    expect(scrubMessageTitle("Order AB12 did not update")).toBe("Order # did not update");
    expect(scrubMessageTitle("Paid £12.50 by card")).toBe("Paid # by card");
    expect(scrubMessageTitle("Could not save: jane@example.com")).toBe("Could not save");
    expect(scrubMessageTitle('Customer "Jane Smith" added')).toBe("Customer # added");
    expect(scrubMessageTitle("Welcome back, Sam")).toBe("Welcome back");
    expect(scrubMessageTitle("x".repeat(300))).toHaveLength(80);
  });

  it("turns a call's URL into a route shape", () => {
    expect(apiRouteShape("/arcarna/api/orders/3f2a9c1e-1111-4222-8333-444455556666/refund?q=jane")).toBe("/api/orders/:id/refund");
    expect(apiRouteShape("https://shop.example/arcarna/api/products/by-barcode/5012345678900")).toBe("/api/products/by-barcode/:id");
    expect(apiRouteShape("/api/customers/search/jane%20smith")).toBe("/api/customers/:value/:value");
    expect(apiRouteShape("/sw.js")).toBe("/other");
  });

  it("never keeps a typed value in a call's route, even one that looks like a word", () => {
    // A gift card code with no digit, a partial one, a typed SKU.
    expect(apiRouteShape("/arcarna/api/gift-cards/ABCDEFGHJKLMNPQR")).toBe("/api/gift-cards/:value");
    expect(apiRouteShape("/api/gift-cards/abcd-efgh")).toBe("/api/gift-cards/:value");
    expect(apiRouteShape("/api/gift-cards/ABCDEFGHJKLMNPQR/validate")).toBe("/api/gift-cards/:value/validate");
    expect(apiRouteShape("/api/products/by-barcode/abc-123")).toBe("/api/products/by-barcode/:value");
    expect(apiRouteShape("/api/Orders/Refund")).toBe("/api/orders/refund");
    expect(apiRouteShape("/api/jane")).toBe("/api/:value");
  });

  it("knows every fixed word in the server's /api routes", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) {
          if (f.name !== "__tests__" && f.name !== "node_modules") walk(p);
        } else if (/\.ts$/.test(f.name) && !/\.(test|spec)\.ts$/.test(f.name)) files.push(p);
      }
    };
    walk(path.resolve(__dirname, "../server"));
    const missing = new Set<string>();
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/["'`](\/api\/[^"'`\s]*)["'`]/g)) {
        for (const seg of m[1].split(/[?#]/)[0].split("/").slice(2)) {
          if (/^[a-z][a-z0-9-]*$/i.test(seg) && !API_ROUTE_WORDS.has(seg.toLowerCase())) missing.add(seg);
        }
      }
    }
    expect([...missing], "add these to shared/apiRouteWords.ts").toEqual([]);
  });

  it("records a call only when it was slow or failed; a signed-out 401 is not friction", () => {
    expect(isFrictionCall(1600, 200)).toBe(true);
    expect(isFrictionCall(1500, 200)).toBe(false);
    expect(isFrictionCall(100, 500)).toBe(true);
    expect(isFrictionCall(100, 409)).toBe(true);
    expect(isFrictionCall(100, 0)).toBe(true);
    expect(isFrictionCall(100, 401)).toBe(false);
  });

  it("shapes each event and drops what is too old, from the future, or not friction", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    const at = now.toISOString();
    expect(normaliseUsageEvent({ kind: "screen", at, screen: "/customers/77?q=jane", activeMs: 5 * H, openMs: H }, now)).toMatchObject({
      kind: "screen",
      screen: "/customers/:id",
      activeMs: H,
      openMs: H,
    });
    expect(normaliseUsageEvent({ kind: "call", at, screen: "/", method: "GET", route: "/api/x", ms: 10, status: 200 }, now)).toBeNull();
    expect(
      normaliseUsageEvent({ kind: "screen", at: "2026-08-01T00:00:00Z", screen: "/", activeMs: 1, openMs: 1 }, now),
    ).toBeNull();
    expect(
      normaliseUsageEvent({ kind: "screen", at: "2026-09-24T13:00:00Z", screen: "/", activeMs: 1, openMs: 1 }, now),
    ).toBeNull();
    // A till a minute ahead is kept, at the server's time.
    expect(
      normaliseUsageEvent({ kind: "funnel", at: "2026-09-24T12:01:00Z", screen: "/operations?pane=order", step: "pay" }, now)?.occurredAt,
    ).toEqual(now);
    expect(normaliseUsageEvent({ kind: "offline", at, screen: "/pos", ms: 60_000 }, now)).toMatchObject({ screen: "", durationMs: 60_000 });
  });

  it("the batch is strict: no user, no text, no amounts can ride along", () => {
    const at = new Date().toISOString();
    const ok = { deviceKey: "abcdefgh12", events: [{ kind: "crash", at, screen: "/", crash: "boundary" }] };
    expect(usageBatchSchema.safeParse(ok).success).toBe(true);
    expect(usageBatchSchema.safeParse({ ...ok, userId: "u1" }).success).toBe(false);
    expect(usageBatchSchema.safeParse({ ...ok, events: [{ kind: "crash", at, screen: "/", crash: "boundary", message: "Jane" }] }).success).toBe(false);
    expect(usageBatchSchema.safeParse({ ...ok, events: [{ kind: "input", at, screen: "/", value: "12.50" }] }).success).toBe(false);
    expect(usageBatchSchema.safeParse({ ...ok, events: Array.from({ length: 201 }, () => ok.events[0]) }).success).toBe(false);
  });
});

describe("pain per active hour", () => {
  it("weights crashes, reports, error messages, failed and slow calls over active hours", () => {
    const s = scoreScreen(t("/pos", { activeMs: 2 * H, crashes: 1, problems: 1, errorMessages: 1, failedCalls: 2, slowCalls: 3 }));
    expect(s).toMatchObject({ weighted: 17, hours: 2, painPerHour: 8.5, information: false });
  });

  it('scores the board per open hour, as an "information screen"', () => {
    const s = scoreScreen(t("/operations", { activeMs: 0, openMs: 10 * H, slowCalls: 2 }));
    expect(s).toMatchObject({ information: true, hours: 10, painPerHour: 0.2 });
  });

  it("does not score a screen with too little use, and lists it last", () => {
    const board = painLeaderboard([
      t("/rare", { activeMs: 10 * 60_000, crashes: 3 }),
      t("/pos", { activeMs: 4 * H, slowCalls: 4 }),
      t("/stock", { activeMs: H, crashes: 1 }),
    ]);
    expect(board.map((s) => s.screen)).toEqual(["/stock", "/pos", "/rare"]);
    expect(board[2].painPerHour).toBeNull();
  });
});

describe('"not enough data yet" and the Monday top five', () => {
  it("needs two weeks before ranking and three weeks before the Monday line", () => {
    expect(daysOfData(null, "2026-09-24")).toBe(0);
    expect(hasEnoughData("2026-09-11", "2026-09-24")).toBe(false);
    expect(hasEnoughData("2026-09-10", "2026-09-24")).toBe(true);
    expect(weeklyAllowed("2026-09-01", "2026-09-21")).toBe(false);
    expect(weeklyAllowed("2026-08-31", "2026-09-21")).toBe(true);
    expect(weeklyAllowed(null, "2026-09-21")).toBe(false);
  });

  it("picks the three worst, then the two fastest-rising, with the raw numbers", () => {
    const last = [
      t("/a", { activeMs: H, crashes: 4 }), // 20
      t("/b", { activeMs: H, crashes: 3 }), // 15
      t("/c", { activeMs: H, crashes: 2 }), // 10
      t("/d", { activeMs: H, slowCalls: 6 }), // 6, was 1
      t("/e", { activeMs: H, slowCalls: 8 }), // 8, was 8
      t("/f", { activeMs: H, slowCalls: 4 }), // 4, new
      t("/quiet", { activeMs: H }),
    ];
    const before = [t("/d", { activeMs: 3 * H, slowCalls: 3 }), t("/e", { activeMs: H, slowCalls: 8 })];
    const top = pickTopFive(last, before);
    expect(top.map((e) => [e.screen, e.why])).toEqual([
      ["/a", "worst"],
      ["/b", "worst"],
      ["/c", "worst"],
      ["/d", "rising"],
      ["/f", "rising"],
    ]);
    expect(topFiveLine(top[3], 3)).toBe("4. /d: 6.0 per active hour (6 slow calls in 1.0 active hours; rising from 1.0)");
  });

  it("labels the board as an information screen in the line", () => {
    const [e] = pickTopFive([t("/operations", { openMs: 5 * H, failedCalls: 5 })], []);
    expect(topFiveLine(e, 0)).toBe("1. /operations (information screen): 2.0 per open hour (5 failed calls in 5.0 open hours; new this week)");
  });

  it('answers "fixed last week: did it work?"', () => {
    expect(fixCheckLine({ screen: "/pos", version: "1.2.1", beforePerHour: 4, afterPerHour: 1, reportsSince: 0 })).toBe(
      "/pos (fixed in 1.2.1): it worked, 4.0 to 1.0 per hour.",
    );
    expect(fixCheckLine({ screen: "/pos", version: null, beforePerHour: 4, afterPerHour: 3, reportsSince: 2 })).toBe(
      "/pos: not yet, 4.0 to 3.0 per hour; 2 Problem? reports since.",
    );
    expect(fixCheckLine({ screen: "/pos", version: null, beforePerHour: 4, afterPerHour: null, reportsSince: 0 })).toBe(
      "/pos: too little use since the fix to tell yet.",
    );
  });
});

describe("improvement study window (no recorder connected)", () => {
  it("is at most 14 days on chosen screens", () => {
    const today = "2026-09-24";
    expect(studyWindowProblem({ enabled: false, screens: [], endsOn: null }, today)).toBeNull();
    expect(studyWindowProblem({ enabled: true, screens: [], endsOn: "2026-09-30" }, today)).toMatch(/at least one screen/);
    expect(studyWindowProblem({ enabled: true, screens: ["/pos"], endsOn: null }, today)).toMatch(/end/);
    expect(studyWindowProblem({ enabled: true, screens: ["/pos"], endsOn: "2026-10-09" }, today)).toMatch(/14 days/);
    expect(studyWindowProblem({ enabled: true, screens: ["/pos"], endsOn: "2026-10-08" }, today)).toBeNull();
    expect(studyWindowProblem({ enabled: true, screens: ["/pos"], endsOn: "2026-09-23" }, today)).toMatch(/passed/);
  });

  it("stores screens as route shapes, and shows only on those screens until the end date", () => {
    const w = normaliseStudyWindow({ enabled: true, screens: ["/customers/77?q=jane", "/customers/78", "/"], endsOn: "2026-09-30" });
    expect(w.screens).toEqual(["/customers/:id"]);
    expect(studyActiveOn(w, "/customers/:id", "2026-09-30")).toBe(true);
    expect(studyActiveOn(w, "/customers/:id", "2026-10-01")).toBe(false);
    expect(studyActiveOn(w, "/stock-levels", "2026-09-25")).toBe(false);
    expect(studyActiveOn({ ...w, enabled: false }, "/customers/:id", "2026-09-25")).toBe(false);
  });
});
