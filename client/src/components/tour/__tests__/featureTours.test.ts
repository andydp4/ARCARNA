import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FEATURE_TOUR_DEFS, featureTourStartEvent, featureToursFor } from "../featureTours";
import { claimTourScreen, releaseTourScreen, resetTourScreen, tourScreenFree } from "../tourScreen";
import { findTourTarget, tourTargetSelector, type TourTarget } from "../tourTarget";
import {
  FEATURE_TOURS,
  FEATURE_TOUR_VERSION,
  featureTourAccountKey,
  featureTourLocalKey,
  isUiSeenKey,
} from "@shared/uiSeen";

const CLIENT_SRC = path.resolve(__dirname, "../../..");

/** Every client source file that could render a test id (tests and the registry itself left out). */
function clientSources(dir = CLIENT_SRC): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...clientSources(full));
    } else if (/\.(tsx|ts)$/.test(name) && !full.endsWith(path.join("tour", "featureTours.ts"))) {
      out.push({ file: full, text: readFileSync(full, "utf8") });
    }
  }
  return out;
}

const SOURCES = clientSources();

/**
 * Whether the client renders this target somewhere. An exact id is either
 * written out ("label-print") or built from a template in a file that also
 * names the rest (`payment-method-${value}` with "card_link"); a prefix id
 * must be the start of a template (`run-stop-${stop.shortCode}`).
 */
function rendered(target: TourTarget): boolean {
  const { testId } = target;
  if (target.match === "prefix") {
    return SOURCES.some(({ text }) => text.includes("`" + testId + "${"));
  }
  if (SOURCES.some(({ text }) => text.includes(`"${testId}"`) || text.includes("`" + testId + "`"))) return true;
  return SOURCES.some(({ text }) => {
    for (const m of Array.from(text.matchAll(/`([a-z0-9_-]+)\$\{/g))) {
      const prefix = m[1];
      if (!testId.startsWith(prefix) || testId === prefix) continue;
      const rest = testId.slice(prefix.length);
      if (text.includes(`"${rest}"`)) return true;
    }
    return false;
  });
}

describe("feature tour registry", () => {
  it("has one tour per name in shared/uiSeen, each with a valid account and device key", () => {
    expect(FEATURE_TOUR_DEFS.map((d) => d.feature).sort()).toEqual([...FEATURE_TOURS].sort());
    for (const feature of FEATURE_TOURS) {
      const key = featureTourAccountKey(feature);
      expect(key).toBe(`featureTour:${feature}-${FEATURE_TOUR_VERSION}`);
      expect(isUiSeenKey(key)).toBe(true);
      expect(featureTourLocalKey(feature)).toBe(`arcarna.featureTour:${feature}-1.2.0`);
    }
    expect(new Set(FEATURE_TOURS.map((f) => featureTourStartEvent(f))).size).toBe(FEATURE_TOURS.length);
  });

  it("covers the v1.2 features the brief names", () => {
    for (const feature of ["needsALook", "myRun", "labelPrinter", "orderTiming", "staffPerformance", "customerContact", "contactAccessLog", "ask"]) {
      expect(FEATURE_TOURS).toContain(feature);
    }
  });

  it("keeps every tour short", () => {
    for (const def of FEATURE_TOUR_DEFS) {
      expect(def.steps.length).toBeGreaterThan(0);
      expect(def.steps.length).toBeLessThanOrEqual(6);
      for (const step of def.steps) {
        expect(step.title.length).toBeGreaterThan(0);
        expect(step.body.length).toBeLessThanOrEqual(240);
      }
    }
  });

  it("mounts each tour on a route the app actually has", () => {
    const app = readFileSync(path.join(CLIENT_SRC, "App.tsx"), "utf8");
    for (const def of FEATURE_TOUR_DEFS) {
      for (const p of def.paths) expect(app, `${def.feature}: ${p}`).toContain(`path="${p}"`);
    }
  });

  it("points only at test ids the client renders", () => {
    const missing: string[] = [];
    for (const def of FEATURE_TOUR_DEFS) {
      for (const target of [def.anchor, ...def.steps]) {
        if (!rendered(target)) missing.push(`${def.feature}: ${target.testId}${target.match === "prefix" ? "*" : ""}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the grep check itself notices a made-up id", () => {
    expect(rendered({ testId: "no-such-test-id-anywhere" })).toBe(false);
    expect(rendered({ testId: "no-such-prefix-", match: "prefix" })).toBe(false);
  });

  it("gives step roles only within the tour's own roles", () => {
    for (const def of FEATURE_TOUR_DEFS) {
      if (!def.roles) continue;
      for (const step of def.steps) {
        for (const r of step.roles ?? []) expect(def.roles, `${def.feature}: ${step.testId}`).toContain(r);
      }
    }
  });
});

describe("featureToursFor", () => {
  const names = (path: string, role: string | null) => featureToursFor(path, role).map((d) => d.feature);

  it("matches the path, ignoring a query string and a trailing slash", () => {
    expect(names("/my-run", "CASHIER")).toEqual(["myRun"]);
    expect(names("/my-run/", "CASHIER")).toEqual(["myRun"]);
    expect(names("/settings?tab=system", "CASHIER")).toEqual(["labelPrinter"]);
    expect(names("/operations?pane=order", "CASHIER"), "no tour opens over a sale").toEqual([]);
    expect(names("/", "SUPER_ADMIN")).toEqual([]);
  });

  it("gives no tour to a shop account or a signed-out viewer", () => {
    expect(names("/my-run", "CUSTOMER")).toEqual([]);
    expect(names("/my-run", null)).toEqual([]);
  });

  it("keeps manager pages' tours from cashiers", () => {
    for (const p of ["/needs-a-look", "/reports/order-timing", "/reports/staff-performance", "/customers", "/customer-access-log"]) {
      expect(names(p, "CASHIER"), p).toEqual([]);
    }
    expect(names("/needs-a-look", "MANAGER")).toEqual(["needsALook"]);
    expect(names("/customer-access-log", "ADMIN")).toEqual([]);
    expect(names("/customer-access-log", "SUPER_ADMIN")).toEqual(["contactAccessLog"]);
  });

  it("tells a manager about masking and asking, and an admin about Access history", () => {
    const manager = featureToursFor("/customers", "MANAGER")[0];
    const admin = featureToursFor("/customers", "ADMIN")[0];
    expect(manager.steps.map((s) => s.title)).toContain("Contact details are masked");
    expect(manager.steps.map((s) => s.title)).not.toContain("Contact and Access history");
    expect(admin.steps.map((s) => s.title)).toEqual(["Contact and Access history"]);
  });

  it("shows contact-request approval in Needs a look to admins only", () => {
    const ids = (role: string) => featureToursFor("/needs-a-look", role)[0].steps.map((s) => s.testId);
    expect(ids("MANAGER")).not.toContain("section-contact-requests");
    expect(ids("ADMIN")).toContain("section-contact-requests");
  });

  it("shows Whose run to managers only", () => {
    const ids = (role: string) => featureToursFor("/my-run", role)[0].steps.map((s) => s.testId);
    expect(ids("CASHIER")).not.toContain("select-run-driver");
    expect(ids("MANAGER")).toContain("select-run-driver");
  });
});

describe("tour targets", () => {
  function fakeRoot(elements: Array<{ id: string; visible: boolean }>) {
    return {
      querySelectorAll(selector: string) {
        const exact = /^\[data-testid="(.*)"\]$/.exec(selector);
        const prefix = /^\[data-testid\^="(.*)"\]$/.exec(selector);
        return elements
          .filter((e) => (exact ? e.id === exact[1] : prefix ? e.id.startsWith(prefix[1]) : false))
          .map((e) => ({ id: e.id, getClientRects: () => (e.visible ? [{}] : []) }));
      },
    } as unknown as ParentNode;
  }

  it("builds an exact or a prefix selector", () => {
    expect(tourTargetSelector({ testId: "label-print" })).toBe('[data-testid="label-print"]');
    expect(tourTargetSelector({ testId: "run-stop-", match: "prefix" })).toBe('[data-testid^="run-stop-"]');
  });

  it("skips a copy hidden by CSS and takes the first one laid out", () => {
    const root = fakeRoot([
      { id: "button-contact-a", visible: false },
      { id: "button-contact-b", visible: true },
    ]);
    const found = findTourTarget({ testId: "button-contact-", match: "prefix" }, root) as unknown as { id: string };
    expect(found.id).toBe("button-contact-b");
    expect(findTourTarget({ testId: "button-contact-a" }, root)).toBeNull();
  });
});

describe("one tour on screen at a time", () => {
  afterEach(() => resetTourScreen());

  it("lets the first tour hold the screen until it gives it back", () => {
    expect(claimTourScreen("centre-tour")).toBe(true);
    expect(tourScreenFree("feature-tour-myRun")).toBe(false);
    expect(claimTourScreen("feature-tour-myRun")).toBe(false);
    // Re-claiming by the holder is fine; a stranger releasing is a no-op.
    expect(claimTourScreen("centre-tour")).toBe(true);
    releaseTourScreen("feature-tour-myRun");
    expect(tourScreenFree("feature-tour-myRun")).toBe(false);
    releaseTourScreen("centre-tour");
    expect(claimTourScreen("feature-tour-myRun")).toBe(true);
  });
});
