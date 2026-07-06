# Training-manual fonts

Per the arcarna Brand Bible (Book 03 · typography; Book 06 · font licensing):

| Font | Role | Licence | In git? |
|------|------|---------|---------|
| **New Astro** (`NewAstro-*.otf`) | Display, wordmark | Adobe Fonts desktop — company use only | **No** (gitignored) |
| **New Astro Soft** (`NewAstroSoft-*.otf`) | All headings | Adobe Fonts desktop — company use only | **No** (gitignored) |
| **Inter** (`Inter-*.woff2`) | Body / running text | SIL Open Font Licence | Yes |
| **IBM Plex Mono** (`PlexMono-*.woff2`) | Eyebrows, values, codes | SIL Open Font Licence | Yes |

## New Astro is intentionally NOT committed

The Bible permits New Astro desktop OTFs to be **embedded in exported PDFs**, but
they must **never be redistributed, bundled with deliverables, or uploaded to
third-party services**. Committing them to the repo would breach that, so they
are gitignored.

To (re)build the PDFs, place the five `NewAstro-*.otf` and four
`NewAstroSoft-*.otf` files (from the founder's asset library) into this folder.
`brand.css` already references them; the render embeds a subset into the PDF.
Without them, headings fall back to a system sans and the wordmark image still
renders correctly.
