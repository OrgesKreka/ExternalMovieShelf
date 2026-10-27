"""Generate the Smart Hub icons into widget/icon/ (pure Python, no dependencies).

Modern flat tile: dark rounded square with three overlapping translucent dots
(amber, teal, violet). Rendered 4x supersampled for smooth edges, saved as RGBA PNG.
"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "widget", "icon")
SIZES = [(85, 70), (95, 78), (106, 87), (115, 95)]
SS = 4                                   # supersampling factor
TOP, BOTTOM = (30, 38, 54), (13, 17, 23)  # background gradient
DOTS = [((255, 180, 0), -0.205), ((47, 211, 164), 0.0), ((123, 108, 255), 0.205)]  # color, x offset (x width)
DOT_ALPHA = 0.88


def png(w, h, rgba):
    raw = b"".join(b"\x00" + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def inside_round_rect(x, y, w, h, r):
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def icon(w, h):
    W, H = w * SS, h * SS
    radius = min(w, h) * 0.18 * SS
    dot_r = min(w, h) * 0.27 * SS
    cy = H * 0.5
    sub = {}  # supersampled pixel -> (r, g, b, a)
    for y in range(H):
        t = y / (H - 1)
        base = tuple(TOP[i] + (BOTTOM[i] - TOP[i]) * t for i in range(3))
        for x in range(W):
            if not inside_round_rect(x + 0.5, y + 0.5, W, H, radius):
                sub[(x, y)] = (0, 0, 0, 0)
                continue
            r, g, b = base
            for color, off in DOTS:
                dx = x + 0.5 - (W * 0.5 + off * W)
                dy = y + 0.5 - cy
                if dx * dx + dy * dy <= dot_r * dot_r:
                    r = r * (1 - DOT_ALPHA) + color[0] * DOT_ALPHA
                    g = g * (1 - DOT_ALPHA) + color[1] * DOT_ALPHA
                    b = b * (1 - DOT_ALPHA) + color[2] * DOT_ALPHA
            sub[(x, y)] = (r, g, b, 255)
    out = bytearray()
    for y in range(h):
        for x in range(w):
            a = rs = gs = bs = 0.0
            for j in range(SS):
                for i in range(SS):
                    pr, pg, pb, pa = sub[(x * SS + i, y * SS + j)]
                    a += pa
                    rs += pr * pa
                    gs += pg * pa
                    bs += pb * pa
            if a == 0:
                out += bytes((0, 0, 0, 0))
            else:
                out += bytes((round(rs / a), round(gs / a), round(bs / a), round(a / (SS * SS))))
    return png(w, h, out)


os.makedirs(OUT, exist_ok=True)
for w, h in SIZES:
    with open(os.path.join(OUT, "icon_%dx%d.png" % (w, h)), "wb") as f:
        f.write(icon(w, h))
    print("icon_%dx%d.png" % (w, h))
