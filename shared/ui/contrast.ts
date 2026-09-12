/**
 * WCAG contrast maths, computed rather than eyeballed.
 *
 * GAP-U5-04 (docs/briefs/GAPS_BACKLOG.md) is a colour that was never run
 * through a calculator: a 60-minute "late" label at 3.05:1, below the 4.5:1
 * WCAG 1.4.3 needs, sitting in production for months because nothing ever
 * measured it. The Operations Centre's whole colour system is different
 * on purpose — every fill/text pair here is asserted by contrast.spec.ts
 * against the real token values in client/src/styles/tokens/*.css, not
 * assumed from how a colour looks in an editor swatch.
 *
 * This module is pure colour math with no filesystem or DOM access, so it
 * is safe to import from a browser bundle; reading the actual CSS files and
 * resolving `var(...)` references against them is contrast.spec.ts's job,
 * not this module's — a production bundle has no business reading .css
 * source off disk.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parses an `hsl(...)` colour in either syntax this codebase actually uses
 * — modern space-separated (`hsl(196 85% 58%)`, arcarna.css) and legacy
 * comma-separated (`hsl(215, 12%, 13%)`, liquid-metal.css) — with an
 * optional trailing alpha, comma- or slash-separated, which is accepted and
 * ignored: every pair this module checks is an opaque fill or solid text
 * colour, and a translucent colour has no fixed contrast ratio without
 * knowing what is behind it. Returns null for anything else, including a
 * bare hex (also not used by these tokens).
 */
export function parseHsl(value: string): { h: number; s: number; l: number } | null {
  const outer = /^hsla?\(\s*(.+?)\s*\)$/i.exec(value.trim());
  if (!outer) return null;
  const [colorPart] = outer[1].split("/");
  const tokens = colorPart
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length < 3) return null;
  const h = Number(tokens[0].replace(/deg$/i, ""));
  const sMatch = /^([\d.]+)%$/.exec(tokens[1]);
  const lMatch = /^([\d.]+)%$/.exec(tokens[2]);
  if (!Number.isFinite(h) || !sMatch || !lMatch) return null;
  return { h, s: Number(sMatch[1]), l: Number(lMatch[1]) };
}

/** Standard HSL → sRGB (0–255 per channel). */
export function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/** Parses this system's colour syntax into sRGB. Throws on anything it cannot parse — a silent 0 would hide a typo'd token as a passing check. */
export function parseColor(value: string): Rgb {
  const hsl = parseHsl(value);
  if (!hsl) {
    throw new Error(`parseColor: not a recognised "hsl(h s% l%)" value: "${value}"`);
  }
  return hslToRgb(hsl.h, hsl.s, hsl.l);
}

/** WCAG relative luminance (the sRGB piecewise gamma curve). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, order-independent, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const rgbA = typeof a === "string" ? parseColor(a) : a;
  const rgbB = typeof b === "string" ? parseColor(b) : b;
  const lumA = relativeLuminance(rgbA);
  const lumB = relativeLuminance(rgbB);
  const [hi, lo] = lumA > lumB ? [lumA, lumB] : [lumB, lumA];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 1.4.3: normal-size text needs at least 4.5:1 against its background. */
export const AA_TEXT_MIN = 4.5;

/** WCAG 1.4.11: a meaningful non-text element (an icon, a focus ring, a state band) needs at least 3:1 against what sits behind it. */
export const AA_NON_TEXT_MIN = 3;

/**
 * Extracts every `--name: value;` custom property declared in a CSS source
 * string. Deliberately shallow — it does not understand selectors, media
 * queries or cascade order, and is not meant to: this codebase's tokens live
 * in a single `:root` block with no light-theme override (see
 * client/src/styles/tokens/arcarna.css's own header), so "every declaration
 * in the file" and "the resolved value" are the same thing here. A file with
 * more than one block per property is exactly what this function is not
 * safe to use on; contrast.spec.ts documents that constraint at its call
 * site rather than this module pretending to solve it.
 */
export function extractCssCustomProperties(source: string): Map<string, string> {
  const props = new Map<string, string>();
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    props.set(match[1], match[2].trim());
  }
  return props;
}

/**
 * Resolves a token value that may itself be `var(--other-token)`, possibly
 * several layers deep (e.g. `--ops-ontime: var(--truth-blue)`), against a
 * property map built by `extractCssCustomProperties`. Throws on a reference
 * to an undeclared property or a cycle, rather than returning something
 * that would silently parse as black.
 */
export function resolveCssVar(props: Map<string, string>, raw: string, seen: Set<string> = new Set()): string {
  const match = /^var\(\s*--([a-zA-Z0-9-]+)\s*\)$/.exec(raw.trim());
  if (!match) return raw.trim();
  const name = match[1];
  if (seen.has(name)) {
    throw new Error(`resolveCssVar: cyclic reference through --${name}`);
  }
  const next = props.get(name);
  if (next == null) {
    throw new Error(`resolveCssVar: --${name} is not declared`);
  }
  seen.add(name);
  return resolveCssVar(props, next, seen);
}
