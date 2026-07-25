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

    # Note: the Viger portal (formerly portal/) is now a separate repo
    # (andydp4/VigerPortal) and carries its own brand assets.


if __name__ == "__main__":
    main()
