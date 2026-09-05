# Brand motion

Two motion systems live here. Both are self-contained HTML pages that can be
opened in a browser to watch live, and both have a headless renderer that
steps them frame by frame rather than screen-recording them.

| System | Files | Status |
|--------|-------|--------|
| **Core Flare** — a machined shell holding a Truth Blue plasma sphere; toothed doors draw apart, the shine escapes, and it settles to the core breathing behind a part-open aperture. | [`arcarna-core-flare.html`](./arcarna-core-flare.html) · [`render-core-flare.mjs`](./render-core-flare.mjs) · [`sync-core-flare.py`](./sync-core-flare.py) · [`generate-core-etch.py`](./generate-core-etch.py) | **Shipping.** Drives the Control Centre backdrop. |
| **Liquid** — a domain-warped fBm field in the Blue Set, rendered as a WebGL shader. Three cuts: the dashboard ground, the ARCARNA **a** revealing itself out of the liquid, and an endcard ending on *by viger cloud*. | [`arcarna-liquid.html`](./arcarna-liquid.html) · [`render-liquid.mjs`](./render-liquid.mjs) | Design source. Not wired into the app. |

Rendered video is written to `dist/marketing/`, which is gitignored — the
sources here are the artefacts worth keeping, and any output can be
regenerated from them exactly.

## Core Flare

`arcarna-core-flare.html` is **generated**, not hand-edited. It is lifted from
the shipping component at
[`client/src/components/dashboard/ControlCentreBackdrop.tsx`](../../client/src/components/dashboard/ControlCentreBackdrop.tsx)
so the two cannot drift:

```bash
python3 scripts/brand/sync-core-flare.py           # regenerate
python3 scripts/brand/sync-core-flare.py --check   # exit 1 if drifted
```

`generate-core-etch.py` produces the ARCARNA mark etched over the shell —
each motif placed by latitude and longitude and foreshortened by the surface
normal, so the pattern crowds toward the limb instead of reading as wallpaper
on a disc.

The page exposes `window.ARCARNA_FLARE.seek(ms)` for frame-stepping.

## Liquid

`arcarna-liquid.html` is the source of truth — there is no component to sync
from yet. Two query parameters drive it:

- `?mode=backdrop|mark|endcard` — picks a cut
- `?bare=1` — strips the page to the stage alone; what the renderer loads,
  and a clean embed for a site

The page exposes `window.ARCARNA_LIQUID.seek(ms)`, `.play()`, `.setMode()`,
`.cuts` and `.period`.

Two properties are load-bearing and easy to break:

**`seek(ms)` must be deterministic.** The renderer steps frames through it, so
the same millisecond has to produce the same pixels every call. Two things had
to be moved onto the timeline for that — the liquid's own clock, and the film
grain, which used to run off a free 40ms timer and put every seek on a
different grain frame. Check it by hashing the same seek twice, revisited out
of order after a delay; they must match, and different seeks must differ, or
the timeline has stalled rather than being deterministic.

**The field loops by construction.** The warp offsets travel a circle rather
than a line, so `cos` and `sin` make the whole field exactly periodic in
`LIQUID_PERIOD` (12000ms). The backdrop clip renders at exactly that length
and therefore joins with no crossfade. After changing the shader, verify the
frame at 0 and the frame at `LIQUID_PERIOD` are identical **and** that an
interior frame differs from both — a field that had simply stopped moving
would also pass the first test.

Looping costs variation, since a cycle has to come back. The two offsets turn
in opposite directions to churn rather than merely orbit.

## Palette

Only the ARCARNA blues, no other hues. These are the Blue Set from
[`docs/training/brand.css`](../../docs/training/brand.css) verbatim — note
that the app's UI tokens in
[`client/src/styles/tokens/arcarna.css`](../../client/src/styles/tokens/arcarna.css)
carry a different, more saturated Truth Blue for interface work; brand motion
follows the brand book, not the UI tokens.

| Token | Hex |
|-------|-----|
| Sky Blue | `#5DB4FF` |
| Light Blue | `#B6D9FF` |
| Truth Blue | `#3C7AC4` |
| Deep Blue | `#123B78` |
| Navy | `#0B2E66` |
| Deep Shadow | `#061327` |

Because every hue is a blue, separation comes from **value**, not hue.

Blue also loses most of its saturation through frost and blur, so the liquid's
ramp is over-saturated at the source (1.26×) to survive it. And blue text on a
lit blue ground is the one pairing this palette cannot afford — Sky Blue over
the liquid measures 3.43:1, under the 4.5:1 floor; Light Blue clears it at
5.22:1.

## Re-rendering

Requires `ffmpeg` on `PATH` and a Chromium binary (both scripts probe
`CHROMIUM_PATH`, `/opt/pw-browsers/chromium` and the usual system paths before
falling back to Playwright's own download).

```bash
node scripts/brand/render-liquid.mjs                        # all three cuts
node scripts/brand/render-liquid.mjs --clip endcard --fps 60
node scripts/brand/render-core-flare.mjs --clip loop
```

Each writes 4K and 1080p, MP4 and WebM, plus a poster, with colour tagged
BT.709 so players do not guess BT.2020 on untagged UHD.

The liquid needs **WebGL**. Headless has no GPU, so `render-liquid.mjs`
launches Chromium with `--use-gl=swiftshader`; that renders correctly but
takes roughly 3 seconds a frame at 4K rather than milliseconds. Two flags
exist because of it:

- `--timeout` (default 120s) — Playwright caps `page.screenshot` at 30s by
  default, which a 4K SwiftShader frame exceeds when workers contend. The wait
  is real work, not a hang.
- `--keep-frames` — frames already on disk are reused, so an interrupted clip
  resumes instead of restarting.
