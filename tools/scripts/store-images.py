# Draws the Chrome Web Store promo tiles in the site's colors. PIL only, no network.
#   python3 tools/scripts/store-images.py
# Output: docs/store/06-promo-tile-440x280.png (required small tile)
#         docs/store/07-marquee-1400x560.png (optional marquee)
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "store" / "06-promo-tile-440x280.png"
MARQUEE = ROOT / "docs" / "store" / "07-marquee-1400x560.png"
BG, INK, SOFT, LINE, ACCENT, SLOT = "#f4f1ea", "#242620", "#5f6258", "#d4d5cb", "#a73825", "#0f110e"

def font(size, bold=False):
    for path in ["/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/HelveticaNeue.ttc", "/Library/Fonts/Arial.ttf"]:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size, index=1 if bold else 0)
            except OSError:
                return ImageFont.truetype(path, size)
    return ImageFont.load_default()

W, H = 440, 280
im = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(im)

# the switch, on the right
px, py, pw, ph = 318, 40, 88, 200
d.rounded_rectangle((px, py, px + pw, py + ph), radius=16, fill="#ece7dc", outline=LINE, width=1)
d.text((px + pw / 2, py + 22), "ON", fill=SOFT, font=font(13), anchor="mm")
sx, sy, sw, sh = px + 24, py + 42, 40, 116
d.rounded_rectangle((sx, sy, sx + sw, sy + sh), radius=9, fill=SLOT)
d.rounded_rectangle((sx + 4, sy + sh * 0.44, sx + sw - 4, sy + sh - 4), radius=7, fill="#fbfaf5")
d.text((px + pw / 2, py + ph - 22), "OFF", fill=ACCENT, font=font(13, bold=True), anchor="mm")

# the words, on the left
d.text((30, 58), "AI, when", fill=INK, font=font(46), anchor="ls")
d.text((30, 108), "you choose.", fill=INK, font=font(46), anchor="ls")
d.text((30, 150), "Hide the AI added to the", fill=SOFT, font=font(17), anchor="ls")
d.text((30, 174), "sites you already use.", fill=SOFT, font=font(17), anchor="ls")
d.text((30, 208), "Free. Open rules. No AI inside.", fill=SOFT, font=font(15), anchor="ls")
d.text((30, 250), "aioff.app", fill=INK, font=font(15), anchor="ls")

OUT.parent.mkdir(parents=True, exist_ok=True)
im.save(OUT, optimize=True)
print(f"wrote {OUT.relative_to(ROOT)} {im.size}")

# the marquee: same layout, wider canvas, the switch sized to the height
W, H = 1400, 560
im = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(im)

px, py, pw, ph = 1060, 70, 180, 420
d.rounded_rectangle((px, py, px + pw, py + ph), radius=32, fill="#ece7dc", outline=LINE, width=2)
d.text((px + pw / 2, py + 46), "ON", fill=SOFT, font=font(26), anchor="mm")
sx, sy, sw, sh = px + 50, py + 88, 80, 244
d.rounded_rectangle((sx, sy, sx + sw, sy + sh), radius=18, fill=SLOT)
d.rounded_rectangle((sx + 8, sy + sh * 0.44, sx + sw - 8, sy + sh - 8), radius=14, fill="#fbfaf5")
d.text((px + pw / 2, py + ph - 46), "OFF", fill=ACCENT, font=font(26, bold=True), anchor="mm")

d.text((100, 190), "AI, when you choose.", fill=INK, font=font(92), anchor="ls")
d.text((100, 280), "Hide the AI added to the sites you already use.", fill=SOFT, font=font(36), anchor="ls")
d.text((100, 350), "Free. Open rules. No AI inside.", fill=SOFT, font=font(32), anchor="ls")
d.text((100, 470), "aioff.app", fill=INK, font=font(32), anchor="ls")

im.save(MARQUEE, optimize=True)
print(f"wrote {MARQUEE.relative_to(ROOT)} {im.size}")
