#!/usr/bin/env python3
"""Generate the sphere-mapped ARCARNA etch used by the Control Centre backdrop.

Prints a CSS `url("data:image/svg+xml,...")` value for the `--arc-etch`
custom property in ControlCentreBackdrop.tsx.

The marks are placed by latitude and longitude and foreshortened by the
surface normal, so they crowd and shrink toward the limb and carry over the
poles. A flat repeating tile was tried first and reads as wallpaper on a
disc — the pattern has to follow the curvature or the sphere looks flat.

Each mark is drawn twice: a dark copy offset up-left and a light copy
offset down-right. Lit from above, a groove is shadowed on its upper wall
and catches light on its lower one, and that offset pair is what makes it
read as cut into the surface rather than printed on it. The offsets are
scaled per mark, so they foreshorten with everything else.

    python3 scripts/brand/generate-core-etch.py
"""
import math

R = C = 100.0     # sphere radius and centre, in viewBox units
BASE = 28         # marks around the full equator
SIZE = 17.0       # mark size at the centre of the sphere, in viewBox units
OFFSET = 0.55     # engrave offset between the dark and light copies
LAT_STEP = 12.0
LAT_MAX = 84.0

# Cull only what is genuinely edge-on. This must stay below cos(LAT_MAX) —
# at 0.14 it sat above cos(84 deg) and silently deleted the polar rows,
# leaving the top and bottom of the sphere bare.
CULL = 0.05

DARK, LIGHT = "%2339455a", "%239aabc0"

# The ARCARNA mark: a thick ring broken at the lower right, plus the leg.
# The break is cut with a dash pattern rather than an arc path, which keeps
# it to two elements and avoids sweep-flag guesswork.
MARK = (
    "%3Ccircle cx='46' cy='45' r='28' fill='none' stroke='{c}' stroke-width='13'"
    " stroke-dasharray='140 36' stroke-dashoffset='-118'/%3E"
    "%3Cpath d='M66 34 L79 42 L96 86 L68 70 Z' fill='{c}'/%3E"
)


def build() -> str:
    defs = (
        "%3Cdefs%3E"
        f"%3Cg id='d' transform='translate(-50 -50)'%3E{MARK.format(c=DARK)}%3C/g%3E"
        f"%3Cg id='l' transform='translate(-50 -50)'%3E{MARK.format(c=LIGHT)}%3C/g%3E"
        "%3C/defs%3E"
    )

    uses, count = [], 0
    lat = -LAT_MAX
    while lat <= LAT_MAX + 0.01:
        phi = math.radians(lat)
        # Fewer marks per row toward the poles, so spacing on the surface
        # stays even instead of bunching where the parallels shorten.
        per_row = max(3, round(BASE * math.cos(phi)))
        step = 360.0 / per_row
        # Stagger alternate rows so the grid never lines up into columns.
        row_offset = (step / 2) if int(round((lat + LAT_MAX) / LAT_STEP)) % 2 else 0.0

        lon = -90.0
        while lon <= 90.01:
            lam = math.radians(lon + row_offset)
            nz = math.cos(phi) * math.cos(lam)      # normal's component toward the viewer
            if nz > CULL:
                x = C + R * math.cos(phi) * math.sin(lam)
                y = C - R * math.sin(phi)
                sx = (SIZE / 100.0) * math.cos(lam)  # foreshorten across
                sy = (SIZE / 100.0) * math.cos(phi)  # foreshorten up and down
                opacity = round(min(1.0, nz ** 0.45) * 0.92, 2)
                for ref, sign in (("d", -1), ("l", 1)):
                    dx = sign * OFFSET * math.cos(lam)
                    dy = sign * OFFSET * math.cos(phi)
                    uses.append(
                        f"%3Cuse href='%23{ref}' transform='translate({x + dx:.1f} {y + dy:.1f})"
                        f" scale({sx:.3f} {sy:.3f})' opacity='{opacity}'/%3E"
                    )
                count += 1
            lon += step
        lat += LAT_STEP

    svg = (
        "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E"
        + defs + "".join(uses) + "%3C/svg%3E"
    )
    print(f"/* {count} marks */", file=__import__("sys").stderr)
    return 'url("data:image/svg+xml,' + svg + '")'


if __name__ == "__main__":
    print(build())
