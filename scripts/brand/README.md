# Brand motion — ARCARNA Light Spheres

An 8-second seamless loop for brand surfaces: chains of luminous spheres
stream in along a glossy floor, round a ninety-degree bend and rocket up out
of frame, mirrored in the floor beneath a soft pool of ambient blue.

| File | What it is |
|------|------------|
| [`arcarna-light-spheres.html`](./arcarna-light-spheres.html) | The animation itself — a single self-contained canvas page. Open it in a browser to watch it live. |
| [`render-brand-loop.mjs`](./render-brand-loop.mjs) | Headless renderer: drives the page frame by frame and encodes to video. |

Rendered output lives in [`client/public/brand/motion/`](../../client/public/brand/motion/).

## Palette

Only the ARCARNA blues, no other hues. These are the Blue Set from
[`docs/training/brand.css`](../../docs/training/brand.css) verbatim — note
that the app's UI tokens in
[`client/src/styles/tokens/arcarna.css`](../../client/src/styles/tokens/arcarna.css)
carry a different, more saturated Truth Blue for interface work; this loop
follows the brand book, not the UI tokens.

| Token | Hex | Role in the loop |
|-------|-----|------------------|
| Sky Blue | `#5DB4FF` | Lead accent — the brightest spheres |
| Light Blue | `#B6D9FF` | Pale highlights and sphere cores |
| Truth Blue | `#3C7AC4` | Mid-value body of most chains |
| Deep Blue | `#123B78` | Recessive chains, floor pool |
| Navy | `#0B2E66` | Ambient haze filling the volume |

Because every hue is a blue, separation between chains comes from **value**,
not hue — the tone weights and the head-to-tail gain ramp in
`buildStreams()` are what keep the bundle legible rather than flat.

## Re-rendering

Requires `ffmpeg` on `PATH` and a Chromium binary (the script probes
`CHROMIUM_PATH`, `/opt/pw-browsers/chromium`, and the usual system paths
before falling back to Playwright's own download).

```bash
# 4K, the archival master
node scripts/brand/render-brand-loop.mjs --width 3840 --no-webm

# 1080p with a VP9 sibling for the web
node scripts/brand/render-brand-loop.mjs --width 1920
```

Useful flags: `--out-dir`, `--name`, `--width`, `--scale` (downscale at
encode time), `--crf`, `--poster-frame`, `--no-webm`.

Rendering is **deterministic** — the animation is a pure function of
normalised loop time and all randomness comes from a seeded PRNG, so the same
inputs always produce the same frames. Frames are piped straight into ffmpeg
rather than written out as PNGs, so a 4K pass needs no scratch disk.

## Editing the look

The knobs worth reaching for first, all near the top of the HTML:

- `CONFIG.streamCount` / `spheresPerStream` — how busy the frame is.
- `EXPOSURE` — overall brightness. Compositing is additive and clamps at
  white, so raising this too far flattens the palette to white and makes the
  square bounds of the sphere sprites visible as hard edges. Check the result
  rather than trusting the number.
- `P_GROUND` / `P_BEND` — share of each cycle spent on the floor and in the
  bend. Perspective squeezes the floor run into a narrow band near the
  horizon, so a large `P_GROUND` piles most spheres into that band.
- `cameraAt(u)` — the camera move. Every term must be periodic in `u` or the
  loop stops being seamless.

After changing anything, re-check the loop closes: the frame-to-frame
difference across the wrap (last frame → first) should sit inside the range
of the interior steps.
