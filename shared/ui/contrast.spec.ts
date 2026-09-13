/**
 * Proves the Operations Centre's card-state colours pass WCAG AA on the
 * REAL surface they render on — not on paper. GAP-U5-04
 * (docs/briefs/GAPS_BACKLOG.md) is the class of bug this guards against: a
 * colour that looked fine and measured 3.05:1, because nobody ever ran the
 * calculator against the token it actually sits on.
 *
 * Reads the two CSS files these tokens are declared in — this is the ONE
 * place in the codebase allowed to reach into a .css file with `fs`, and
 * only because a Node-side spec, not a browser bundle, is doing it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AA_NON_TEXT_MIN,
  AA_TEXT_MIN,
  contrastRatio,
  extractCssCustomProperties,
  parseHsl,
  resolveCssVar,
} from "./contrast";

const ROOT = join(__dirname, "..", "..");
const arcarnaCss = readFileSync(join(ROOT, "client/src/styles/tokens/arcarna.css"), "utf8");
const liquidMetalCss = readFileSync(join(ROOT, "client/src/styles/tokens/liquid-metal.css"), "utf8");

// arcarna.css declares its :root block once with no light-theme override
// (see its own header comment) and liquid-metal.css's FIRST :root block is
// the live surface (.liquid-metal scope) — a later block in that file is a
// legacy `.lm-auth-shell`-only remap this app's board never renders under,
// so only the first block is read here, deliberately.
const liquidMetalFirstRoot = liquidMetalCss.slice(0, liquidMetalCss.indexOf("\n}") + 2);

const props = new Map([
  ...extractCssCustomProperties(liquidMetalFirstRoot),
  ...extractCssCustomProperties(arcarnaCss), // arcarna.css tokens win on overlap (none expected)
]);

function resolved(name: string): string {
  const raw = props.get(name);
  if (raw == null) throw new Error(`token --${name} is not declared in arcarna.css or liquid-metal.css`);
  return resolveCssVar(props, raw);
}

function ratio(a: string, b: string): number {
  return contrastRatio(resolved(a), resolved(b));
}

describe("every colour token this spec relies on parses cleanly", () => {
  // Deliberately not "every declared custom property" — this file also
  // declares gradients, shadows, radii and font stacks (e.g.
  // --lm-surface-gradient), which are not colours and are not what a card's
  // fill/text/border pair is measured against.
  const used = [
    "card",
    "foreground",
    "muted-foreground",
    "truth-blue",
    "truth-blue-bright",
    "truth-blue-subtle",
    "danger",
    "warning",
    "success",
    "ops-ontime",
    "ops-ready",
    "ops-ready-text",
    "ops-held",
    "ops-held-text",
    "ops-delayed",
    "ops-delayed-text",
    "ops-late",
    "ops-late-text",
    "ops-completed",
    "ops-completed-text",
    "ops-alert",
  ];

  it.each(used)("--%s resolves to a parseable hsl() colour", (name) => {
    expect(parseHsl(resolved(name)), `--${name} -> ${resolved(name)}`).not.toBeNull();
  });
});

describe("the real card surface", () => {
  it("is the gunmetal liquid-metal surface", () => {
    // Sanity check on the fixture itself: if this ever stops resolving to
    // --lm-gunmetal, every ratio below is being measured against the wrong
    // background and the whole spec is meaningless.
    expect(resolved("card")).toBe(resolveCssVar(props, "var(--lm-gunmetal)"));
  });
});

describe("card-state fill/text pairs — WCAG 1.4.3, >= 4.5:1", () => {
  const pairs: Array<[string, string, string]> = [
    ["--ops-ready fill vs its text", "ops-ready", "ops-ready-text"],
    ["--ops-held fill vs its text", "ops-held", "ops-held-text"],
    ["--ops-delayed fill vs its text", "ops-delayed", "ops-delayed-text"],
    ["--ops-late fill vs its text", "ops-late", "ops-late-text"],
    ["--ops-completed fill vs its text", "ops-completed", "ops-completed-text"],
  ];

  it.each(pairs)("%s is >= 4.5:1", (_label, fill, text) => {
    expect(ratio(fill, text)).toBeGreaterThanOrEqual(AA_TEXT_MIN);
  });

  it("--muted-foreground meta text on the plain card surface is >= 4.5:1 (never on a tinted body)", () => {
    expect(ratio("muted-foreground", "card")).toBeGreaterThanOrEqual(AA_TEXT_MIN);
  });

  it("--foreground body text on the plain card surface is >= 4.5:1", () => {
    expect(ratio("foreground", "card")).toBeGreaterThanOrEqual(AA_TEXT_MIN);
  });
});

describe("state band / border on the card — WCAG 1.4.11, >= 3:1", () => {
  const bands: Array<[string, string]> = [
    ["ops-ontime", "on time"],
    ["ops-ready", "ready"],
    ["ops-held", "held"],
    ["ops-delayed", "delayed"],
    ["ops-late", "late"],
    ["ops-completed", "completed"],
    ["ops-alert", "the alert pulse ring"],
  ];

  it.each(bands)("--%s (%s) is >= 3:1 against the card", (token) => {
    expect(ratio(token, "card")).toBeGreaterThanOrEqual(AA_NON_TEXT_MIN);
  });
});

describe("the states the owner explicitly asked to be distinguishable", () => {
  it("ready is not just a darker on-time — it is far enough from Truth Blue to read as a different colour", () => {
    // Regression guard for the literal bug: --truth-blue-strong measured
    // 2.42:1 against the card (invisible) and only 1.33:1 from --truth-blue
    // (indistinguishable). --ops-ready must clear the 3:1 non-text floor
    // AND sit well clear of --ops-ontime.
    expect(ratio("ops-ready", "card")).toBeGreaterThanOrEqual(AA_NON_TEXT_MIN);
    expect(ratio("ops-ready", "ops-ontime")).toBeGreaterThanOrEqual(2);
  });

  it("late (red) and delayed (orange) are visibly different from each other", () => {
    expect(ratio("ops-late", "ops-delayed")).toBeGreaterThanOrEqual(1.5);
  });

  it("completed (green) is visibly different from on-time (blue)", () => {
    expect(ratio("ops-completed", "ops-ontime")).toBeGreaterThanOrEqual(1.5);
  });
});
