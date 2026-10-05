#!/usr/bin/env python3
"""Side-by-side before and after image for the store, same layout as docs/store/00-before-after.png.

    python3 google-compose.py before.png after.png out.png "caption line 1" "caption line 2"

Called by google-shots.ts. Needs Pillow. Inputs are 1280x800 screenshots; output is 1280x800.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

BG = (0xF4, 0xF1, 0xEA)
INK = (0x24, 0x26, 0x20)
ACCENT = (0xA7, 0x38, 0x25)
MUTED = (0x5D, 0x5A, 0x52)
W, H = 1280, 800
PANEL_W, PANEL_H = 620, 388  # 1280x800 scaled to 620 wide, rounded up
LEFT_X, RIGHT_X, PANEL_Y = 13, 647, 80


def font(size):
    for path in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main():
    before, after, out = sys.argv[1], sys.argv[2], sys.argv[3]
    lines = sys.argv[4:6]
    canvas = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(canvas)
    draw.text((LEFT_X, 22), "AI on", font=font(36), fill=INK)
    draw.text((RIGHT_X, 22), "AI off", font=font(36), fill=ACCENT)
    for path, x in ((before, LEFT_X), (after, RIGHT_X)):
        shot = Image.open(path).convert("RGB").resize((PANEL_W, PANEL_H), Image.LANCZOS)
        canvas.paste(shot, (x, PANEL_Y))
    y = 496
    for line in lines:
        draw.text((LEFT_X, y), line, font=font(22), fill=MUTED)
        y += 40
    canvas.save(out)


if __name__ == "__main__":
    main()
