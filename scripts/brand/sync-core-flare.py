#!/usr/bin/env python3
"""Regenerate the Core Flare design source from the shipping component.

scripts/brand/arcarna-core-flare.html is a standalone preview of the
Control Centre backdrop. Hand-maintaining it guarantees drift, so it is
generated: the stylesheet and markup are lifted verbatim from
client/src/components/dashboard/ControlCentreBackdrop.tsx and wrapped in a
page that adds a stage and a seek helper.

    python3 scripts/brand/sync-core-flare.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "client/src/components/dashboard/ControlCentreBackdrop.tsx"
OUT = ROOT / "scripts/brand/arcarna-core-flare.html"

PAGE_CSS = """/*
 * ARCARNA — Core Flare
 * ------------------------------------------------------------------
 * Design source for the Control Centre backdrop. Generated from the
 * shipping component so the two cannot drift: the stylesheet and markup
 * below are lifted verbatim from
 * client/src/components/dashboard/ControlCentreBackdrop.tsx.
 *
 * A machined shell holds a Truth Blue plasma sphere. Toothed doors draw
 * apart, the shine escapes in a burst, the eye adjusts, and it settles
 * to the core breathing behind a part-open door.
 *
 * The etch generator lives in scripts/brand/generate-core-etch.py.
 */
html, body { margin: 0; height: 100%; background: #05080f; }
.stage {
  position: relative; width: 100%; height: 420px; overflow: hidden;
  background: radial-gradient(120% 140% at 50% 46%, #0a1526 0%, #05080f 62%, #03050a 100%);
}
"""

SEEK = """<script>
/* Seek a paused animation by giving it a negative delay. The settled pulse
   starts 2700ms in, so it needs its own offset or it lands out of phase. */
window.ARCARNA_FLARE = {
  seek(ms) {
    document.querySelectorAll('.arc-cf *').forEach((el) => {
      const names = getComputedStyle(el).animationName;
      if (!names || names === 'none') return;
      el.style.animationPlayState = 'paused';
      el.style.animationDelay = names.split(',')
        .map((n) => (n.trim().endsWith('pulse') ? `${-(ms - 2700)}ms` : `${-ms}ms`)).join(', ');
    });
  },
};
</script>"""


def extract(text: str, opening: str, closing: str) -> str:
    start = text.index(opening) + len(opening)
    return text[start:text.index(closing, start)]


def build() -> str:
    tsx = SRC.read_text(encoding="utf-8")
    css = extract(tsx, "<style>{`", "`}</style>")
    body = extract(tsx, "`}</style>\n", "\n    </div>\n  );")

    # JSX to HTML: comments have no equivalent, attributes are renamed, and
    # self-closing divs are not a thing outside of XHTML.
    body = re.sub(r"\{/\*.*?\*/\}", "", body, flags=re.S)
    body = body.replace("className=", "class=").replace("/>", "></div>")
    body = body.strip()

    return (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\" />\n"
        "<title>ARCARNA — Core Flare</title>\n<style>\n"
        + PAGE_CSS + css + "\n</style>\n</head>\n<body>\n"
        "<div class=\"stage\" id=\"stage\"><div class=\"arc-cf\" "
        "style=\"position:absolute;inset:0\">\n" + body + "\n</div></div>\n"
        + SEEK + "\n</body>\n</html>\n"
    )


if __name__ == "__main__":
    page = build()
    if "--check" in sys.argv:
        current = OUT.read_text(encoding="utf-8")
        print("in sync" if current == page else "OUT OF SYNC")
        sys.exit(0 if current == page else 1)
    OUT.write_text(page, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(page)} bytes)")
