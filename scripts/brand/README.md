# Brand motion

Two motion systems live here. Both are self-contained HTML pages that can be
opened in a browser to watch live, and both have a headless renderer that
steps them frame by frame rather than screen-recording them.

| System | Files | Status |
|--------|-------|--------|
| **Core Flare** — a machined shell holding a Truth Blue plasma sphere; toothed doors draw apart, the shine escapes, and it settles to the core breathing behind a part-open aperture. | [`arcarna-core-flare.html`](./arcarna-core-flare.html) · [`render-core-flare.mjs`](./render-core-flare.mjs) · [`sync-core-flare.py`](./sync-core-flare.py) · [`generate-core-etch.py`](./generate-core-etch.py) | **Shipping.** Drives the Control Centre backdrop. |
| **Liquid** — a domain-warped fBm field in the Blue Set, rendered as a WebGL shader. Five cuts: the dashboard ground, the ARCARNA **a** rising out of the liquid, the **a** alone, and two endcards ending on *by viger cloud*. | [`arcarna-liquid.html`](./arcarna-liquid.html) · [`render-liquid.mjs`](./render-liquid.mjs) | Design source. The backdrop cut ships as [`ControlCentreLiquidBackdrop.tsx`](../../client/src/components/dashboard/ControlCentreLiquidBackdrop.tsx). |

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

`arcarna-liquid.html` is the source of truth. Two query parameters drive it:

- `?mode=backdrop|mark|markSolo|endcard|cloud` — picks a cut
- `?bare=1` — strips the page to the stage alone; what the renderer loads,
  and a clean embed for a site

The page exposes `window.ARCARNA_LIQUID.seek(ms)`, `.play()`, `.setMode()`,
`.bare()`, `.cuts` and `.period`.

### The reveal arc

Every cut with a mark in it shares one 13.8-second arc, and the arc is three
separate beats rather than one cross-fade:

| beat | window | what happens |
|------|--------|--------------|
| `u_markIn` | 1.5s → 5.5s | the **a** rises out of the field, which is still whole |
| `u_drain`  | 6.3s → 11.0s | the mass recedes from under it, leaving the **a** |
| `u_white`  | 11.8s → 13.8s | the **a** goes solid white |

This replaces a single `u_reveal` that ran 1.7 seconds and faded the surround
out while fading the letterform in. The two moved together, so the **a** was
never legible against a full field — by the time you could see it there was
nothing behind it. Each beat now has a hold after it; the pauses are what
make it read as three things happening rather than one.

The drain is not an opacity fade. The noise field is itself the threshold, so
the dark troughs empty before the bright ribbons and the level falls from the
top down — liquid receding rather than a light going out.

After the arc the cuts diverge: `markSolo` and `mark` run the arc backwards
and loop, `endcard` hands to the lockup and spins out, `cloud` holds five
seconds on the white **a** before *by viger cloud*.

### The lockup

The bottom of the title cuts is `arcarna-mark_Master-Wordmark.png` as
supplied, cropped to its own ink and embedded as a data URI so the page stays
self-contained. It replaces a hand-set ARCARNA in Inter at 0.42em tracking,
which approximated the wordmark rather than being it.

The master is the **full lockup** — the **a** is already in it. So the
animated **a** hands over to it rather than sitting above it; showing both
would put the mark on screen twice. A cut wanting the mark above a wordmark
needs a wordmark-only master.

It is Truth Blue `#3C7AC4`, and measures **3.52:1** against its local ground
on these cuts (3.16:1 against the brightest part of the glow). That clears
the 3:1 floor for large non-text and a logotype is exempt from 1.4.3 anyway,
but it is worth knowing it is not a white lockup — the **a** above it is.

### Load-bearing properties

Two are easy to break:

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

The same constraint sets the length of the two looping cuts. `mark` and
`markSolo` run **24000ms** — two turns of the period — so the last frame joins
the first exactly. 15-18s would be the nicer length and would pop at the seam.
Check the join the same way: frame 0 and frame 24000 identical, an interior
frame different.

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
node scripts/brand/render-liquid.mjs                        # all five cuts
node scripts/brand/render-liquid.mjs --clip endcard --fps 60
node scripts/brand/render-core-flare.mjs --clip loop
```

Clip lengths in `render-liquid.mjs` mirror `CUTS` in the page and have to stay
in step with it — `mark` and `marksolo` 24s, `endcard` and `cloud` 21s,
`backdrop` 12s.

Each writes two resolutions — the one rendered and half of it — as MP4 and
WebM, plus a poster, with colour tagged BT.709 so players do not guess BT.2020
on untagged UHD. At the default `--dpr 3` that is 4K and 1080p; the filenames
follow the actual height, so `--dpr 1.5` gives `-1080` and `-540` rather than
labelling a 1080p file `-4k`.

A lower `--dpr` is the way to get watchable files quickly. Frame cost is
mostly fragment shading, so `--dpr 1.5` is roughly twice as fast as the
default — useful for judging pacing before committing to a 4K pass. Send it
to its own `--out-dir` so the resumable frame cache does not mix resolutions:
frames are reused on name alone, and nothing checks their dimensions.

The liquid needs **WebGL**. Headless has no GPU, so `render-liquid.mjs`
launches Chromium with `--use-gl=swiftshader`; that renders correctly but
takes roughly 3 seconds a frame at 4K rather than milliseconds. Two flags
exist because of it:

- `--timeout` (default 120s) — Playwright caps `page.screenshot` at 30s by
  default, which a 4K SwiftShader frame exceeds when workers contend. The wait
  is real work, not a hang.
- `--keep-frames` — frames already on disk are reused, so an interrupted clip
  resumes instead of restarting.
