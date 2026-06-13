#!/usr/bin/env python3
"""Regenerate favicon and PWA icons from arcarna-mark.png; copy wordmark for portal."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MARK_SRC = ROOT / "client/public/brand/arcarna-mark.png"
WORDMARK_SRC = ROOT / "client/public/brand/arcarna-wordmark.png"

MARK_OUTPUTS: dict[Path, int] = {
    ROOT / "client/public/logo.png": 256,
    ROOT / "client/public/favicon-32.png": 32,
    ROOT / "client/public/icon-192.png": 192,
    ROOT / "client/public/icon-512.png": 512,
}


def main() -> None:
    if not MARK_SRC.is_file():
        raise SystemExit(f"Missing mark logo: {MARK_SRC}")

    mark = Image.open(MARK_SRC).convert("RGBA")
    for path, size in MARK_OUTPUTS.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        resized = mark.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(path, format="PNG", optimize=True)
        print(f"wrote {path.relative_to(ROOT)} ({size}x{size})")

    if WORDMARK_SRC.is_file():
        portal_dest = ROOT / "portal/portal-assets/arcarna-wordmark.png"
        portal_dest.parent.mkdir(parents=True, exist_ok=True)
        wordmark = Image.open(WORDMARK_SRC).convert("RGBA")
        wordmark.save(portal_dest, format="PNG", optimize=True)
        print(f"wrote {portal_dest.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
