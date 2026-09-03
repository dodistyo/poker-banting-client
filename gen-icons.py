#!/usr/bin/env python3
"""Generate PWA icons for Poker Banting: navy bg, white spade.
Outputs: icons/icon-192.png, icon-512.png, icon-maskable-512.png,
apple-touch-icon.png (180), favicon-32.png."""
from PIL import Image, ImageDraw, ImageFont
import os

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "icons")
os.makedirs(OUT, exist_ok=True)

NAVY = (22, 33, 62, 255)      # #16213e header bg
WHITE = (255, 255, 255, 255)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
SPADE = "\u2660"  # ♠


def draw_spade_layer(size):
    """Transparent size x size image with a centered spade glyph."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fs = int(size * 0.62)
    font = ImageFont.truetype(FONT, fs)
    bbox = d.textbbox((0, 0), SPADE, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - w) / 2 - bbox[0]
    y = (size - h) / 2 - bbox[1] + size * 0.01  # optical center
    d.text((x, y), SPADE, font=font, fill=WHITE)
    return img


def make_icon(size, full_bleed=False):
    img = Image.new("RGBA", (size, size), NAVY)
    spade = draw_spade_layer(size)
    # Maskable icons need the content inside the 80% safe zone.
    if full_bleed:
        spade = spade.resize((int(size * 0.72), int(size * 0.72)), Image.Resampling.LANCZOS)
        off = (size - spade.width) // 2
        img.alpha_composite(spade, (off, off))
        return img
    # Regular icon: rounded-corner look via a transparent mask.
    img.paste(spade, ((size - spade.width) // 2, (size - spade.height) // 2), spade)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size, size), radius=size // 5, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


make_icon(192).save(f"{OUT}/icon-192.png")
make_icon(512).save(f"{OUT}/icon-512.png")
make_icon(512, full_bleed=True).save(f"{OUT}/icon-maskable-512.png")
make_icon(180).save(f"{OUT}/apple-touch-icon.png")
make_icon(32).save(f"{OUT}/favicon-32.png")
print("icons written:", sorted(os.listdir(OUT)))
