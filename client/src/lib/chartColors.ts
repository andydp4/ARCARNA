/**
 * Brand chart palette.
 *
 * Mirrors the Truth Blue / semantic tokens in
 * `styles/tokens/arcarna.css` + `styles/tokens/liquid-metal.css`. Kept in JS
 * (not CSS `var()`) because Recharts renders colours as SVG **presentation
 * attributes**, and `var()` is not resolved in attribute values — only in CSS
 * declarations. If the CSS tokens change, update these to match.
 *
 * Use CHART_SERIES for categorical series, and the semantic constants for
 * profit/loss/warning framing so charts read as "revealed truth", not a
 * random rainbow.
 */

/** Categorical series palette (Truth Blue family + on-brand accents). */
export const CHART_SERIES = [
  "hsl(208 96% 64%)", // truth-blue-bright (chart-1)
  "hsl(200 60% 52%)", // sky (chart-2)
  "hsl(158 64% 42%)", // emerald / positive
  "hsl(38 92% 50%)", // amber / warning
  "hsl(190 35% 45%)", // teal (chart-3)
  "hsl(280 55% 62%)", // violet accent
  "hsl(216 12% 55%)", // stainless (chart-4)
  "hsl(216 10% 38%)", // graphite (chart-5)
] as const;

/** Primary "truth" highlight — revenue, focus series. */
export const CHART_PRIMARY = "hsl(208 96% 64%)";
/** Positive / profit / in-stock. */
export const CHART_POSITIVE = "hsl(158 64% 42%)";
/** Negative / loss / refunds. */
export const CHART_NEGATIVE = "hsl(0 72% 51%)";
/** Warning / at-risk / low stock. */
export const CHART_WARNING = "hsl(38 92% 50%)";

/** Back-compat alias for pages that imported a `COLORS` array. */
export const COLORS = CHART_SERIES;
