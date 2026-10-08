# Frames real iPhone or iPad screenshots at the exact sizes App Store Connect accepts, with a
# short caption above each in the site's colors. PIL only, no network.
#   python3 tools/scripts/appstore-shots.py iphone  <out dir> <caption>::<screenshot> [...]
#   python3 tools/scripts/appstore-shots.py ipad    <out dir> <caption>::<screenshot> [...]
# iphone = 1320x2868 (6.9 inch), ipad = 2064x2752 (13 inch). The screenshot keeps its aspect
# ratio and is scaled to fit under the caption with rounded corners; nothing in it is altered.
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BG, INK, SOFT, ACCENT = "#f4f1ea", "#242620", "#5f6258", "#a73825"
SIZES = {"iphone": (1320, 2868), "ipad": (2064, 2752)}

def font(size, bold=False):
    for path in ["/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/HelveticaNeue.ttc", "/Library/Fonts/Arial.ttf"]:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size, index=1 if bold else 0)
            except OSError:
                return ImageFont.truetype(path, size)
    return ImageFont.load_default()

def rounded(im, radius):
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=radius, fill=255)
    out = Image.new("RGB", im.size, BG)
    out.paste(im, (0, 0), mask)
    return out

def frame(kind, caption, src, dst):
    W, H = SIZES[kind]
    canvas = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(canvas)
    scale = W / 1320
    big, small = font(int(84 * scale), bold=True), font(int(40 * scale))
    title, _, sub = caption.partition("|")
    y = int(150 * scale)
    d.text((W / 2, y), title.strip(), fill=INK, font=big, anchor="ma")
    y += int(110 * scale)
    if sub.strip():
        d.text((W / 2, y), sub.strip(), fill=SOFT, font=small, anchor="ma")
        y += int(70 * scale)
    top = y + int(60 * scale)
    shot = Image.open(src).convert("RGB")
    avail_h = H - top - int(90 * scale)
    avail_w = W - int(160 * scale)
    r = min(avail_w / shot.width, avail_h / shot.height)
    shot = shot.resize((round(shot.width * r), round(shot.height * r)), Image.LANCZOS)
    shot = rounded(shot, int(56 * scale))
    x = (W - shot.width) // 2
    d.rounded_rectangle((x - 6, top - 6, x + shot.width + 5, top + shot.height + 5), radius=int(60 * scale), outline="#d4d5cb", width=4)
    canvas.paste(shot, (x, top))
    canvas.save(dst, optimize=True)
    print(f"wrote {dst} {canvas.size}")

if __name__ == "__main__":
    kind, out = sys.argv[1], Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for i, spec in enumerate(sys.argv[3:], 1):
        caption, _, src = spec.partition("::")
        frame(kind, caption, src, out / f"{kind}-{i:02d}.png")
