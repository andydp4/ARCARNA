#!/usr/bin/env python3
"""Regenerate favicon, PWA icons, and brand PNGs from midnight-logo-master.png."""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "client/public/brand/midnight-logo-master.png"

OUTPUTS: dict[Path, int] = {
    ROOT / "client/public/brand/midnight-logo-white-on-navy.png": 512,
    ROOT / "client/public/brand/midnight-logo-navy-on-white.png": 512,
    ROOT / "client/public/logo.png": 256,
    ROOT / "client/public/favicon-32.png": 32,
    ROOT / "client/public/icon-192.png": 192,
    ROOT / "client/public/icon-512.png": 512,
    ROOT / "portal/portal-assets/midnight-logo-white-on-navy.png": 512,
}


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"Missing master logo: {SRC}")

    img = Image.open(SRC).convert("RGBA")
    for path, size in OUTPUTS.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(path, format="PNG", optimize=True)
        print(f"wrote {path.relative_to(ROOT)} ({size}x{size})")


if __name__ == "__main__":
    main()
