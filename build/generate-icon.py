"""Regenerate Windows icons from the original PNG: python build/generate-icon.py.

Requires Pillow (python -m pip install Pillow). Keep alpha when resampling;
derive every size from the original rather than an already reduced icon.
"""

from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parent.parent
SIZES = (16, 20, 24, 28, 32, 40, 48, 56, 60, 64, 72, 80, 96, 128, 256)

with Image.open(ROOT / "logo.png") as source:
    source = source.convert("RGBA")
    frames = []
    for size in SIZES:
        scaled = ImageOps.contain(source, (size, size), Image.Resampling.LANCZOS)
        frame = Image.new("RGBA", (size, size))
        frame.paste(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2))
        frames.append(frame)
    frames[-1].save(
        ROOT / "build" / "icon.ico",
        sizes=[(size, size) for size in SIZES],
        append_images=frames[:-1],
    )
