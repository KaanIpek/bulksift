"""Generate the mobile app icons, matching the web app's icon.

Drawn rather than converted: rendering the SVG would need a renderer that is not
installed, and the shape is simple enough to draw directly. Sizes follow Expo's
expectations (1024 icon, 1024 adaptive foreground on a transparent field).
"""
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "apps", "mobile", "assets")
os.makedirs(OUT, exist_ok=True)

BG = (11, 14, 20)
CARD = (26, 32, 48)
INK = (92, 200, 255)
RETICLE = (134, 239, 172)
DIM = (38, 48, 73)

S = 1024
SS = 4  # supersample for smooth edges


def rounded(draw, box, r, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def draw_card(img, cx, cy, w, h, angle_deg):
    """Draw the card on its own layer, then rotate and paste."""
    pad = int(max(w, h) * 0.4)
    layer = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0 = pad, pad
    rounded(d, (x0, y0, x0 + w, y0 + h), int(w * 0.085),
            fill=CARD + (255,), outline=INK + (255,), width=int(w * 0.045))

    # art window
    aw, ah = int(w * 0.79), int(h * 0.43)
    ax, ay = x0 + (w - aw) // 2, y0 + int(h * 0.085)
    rounded(d, (ax, ay, ax + aw, ay + ah), int(aw * 0.045), fill=BG + (255,))

    # lens glyph inside the art window
    r = int(min(aw, ah) * 0.36)
    lx, ly = ax + aw // 2, ay + ah // 2
    d.ellipse((lx - r, ly - r, lx + r, ly + r), outline=INK + (255,), width=int(w * 0.045))
    d.line((lx - r, ly, lx + r, ly), fill=INK + (255,), width=int(w * 0.045))
    rr = int(r * 0.33)
    d.ellipse((lx - rr, ly - rr, lx + rr, ly + rr), fill=INK + (255,))

    # text lines
    tw = int(w * 0.56)
    ty = y0 + int(h * 0.62)
    bar = int(h * 0.045)
    rounded(d, (ax, ty, ax + tw, ty + bar), bar // 2, fill=DIM + (255,))
    rounded(d, (ax, ty + int(bar * 2.2), ax + int(tw * 0.7), ty + int(bar * 2.2) + bar),
            bar // 2, fill=DIM + (255,))

    layer = layer.rotate(angle_deg, resample=Image.BICUBIC, expand=False)
    img.alpha_composite(layer, (cx - layer.width // 2, cy - layer.height // 2))


def draw_reticle(img):
    d = ImageDraw.Draw(img)
    w = int(S * SS * 0.032)
    m = int(S * SS * 0.17)
    arm = int(S * SS * 0.115)
    r = int(S * SS * 0.05)
    W, H = img.size
    for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        cx = m if sx > 0 else W - m
        cy = m if sy > 0 else H - m
        d.line((cx, cy + sy * r, cx, cy + sy * (r + arm)), fill=RETICLE + (255,), width=w)
        d.line((cx + sx * r, cy, cx + sx * (r + arm), cy), fill=RETICLE + (255,), width=w)
        d.arc(
            (min(cx, cx + sx * 2 * r), min(cy, cy + sy * 2 * r),
             max(cx, cx + sx * 2 * r), max(cy, cy + sy * 2 * r)),
            start=180 if (sx > 0 and sy > 0) else 270 if (sx < 0 and sy > 0)
            else 90 if (sx > 0 and sy < 0) else 0,
            end=270 if (sx > 0 and sy > 0) else 360 if (sx < 0 and sy > 0)
            else 180 if (sx > 0 and sy < 0) else 90,
            fill=RETICLE + (255,), width=w,
        )


def build(with_background: bool):
    img = Image.new("RGBA", (S * SS, S * SS), BG + (255,) if with_background else (0, 0, 0, 0))
    cw = int(S * SS * 0.40)
    chh = int(cw * 342 / 245)
    draw_card(img, img.width // 2, img.height // 2, cw, chh, 11)
    draw_reticle(img)
    return img.resize((S, S), Image.LANCZOS)


def main():
    icon = build(True)
    icon.convert("RGB").save(os.path.join(OUT, "icon.png"))
    build(False).save(os.path.join(OUT, "adaptive-icon.png"))

    # splash: the same mark, small, on the app background
    splash = Image.new("RGBA", (1284, 2778), BG + (255,))
    mark = icon.resize((420, 420), Image.LANCZOS)
    splash.alpha_composite(mark, ((1284 - 420) // 2, (2778 - 420) // 2))
    splash.convert("RGB").save(os.path.join(OUT, "splash.png"))

    favicon = icon.resize((196, 196), Image.LANCZOS)
    favicon.convert("RGB").save(os.path.join(OUT, "favicon.png"))

    for f in ("icon.png", "adaptive-icon.png", "splash.png", "favicon.png"):
        p = os.path.join(OUT, f)
        print(f"  {f:20s} {Image.open(p).size}  {os.path.getsize(p)/1000:.0f} KB")


if __name__ == "__main__":
    main()
