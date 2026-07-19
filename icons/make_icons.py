#!/usr/bin/env python3
"""Generate Abridged's PWA icons from leaf.svg.

Pure stdlib: parses the SVG path, flattens its beziers to polygons, and
scanline-fills them with 4x supersampling. No Pillow, no ImageMagick, no
browser. Run it from anywhere — output lands next to this file.
"""
import math, os, re, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
GREEN = (46, 75, 60)      # #2E4B3C
WHITE = (255, 255, 255)
SS = 4                    # supersample factor per axis
VB = 540.0                # leaf.svg viewBox size

# Each icon: filename, pixel size, background style, leaf width as a fraction
# of the canvas. 'any' is inset because desktop draws its own rounded-square
# tile; 'maskable' keeps the mark inside Android's 80% safe zone; 'apple' and
# 'maskable' are opaque edge to edge because both platforms mask them
# themselves and transparency would composite against black.
ICONS = [
    ('mark-96.png',           96, 'circle', 0.60),   # header logo + favicon
    ('icon-180.png',         180, 'square', 0.62),   # apple-touch-icon
    ('icon-192.png',         192, 'inset',  0.50),   # manifest "any"
    ('icon-512.png',         512, 'inset',  0.50),
    ('icon-192-maskable.png', 192, 'square', 0.54),  # manifest "maskable"
    ('icon-512-maskable.png', 512, 'square', 0.54),
]


# ── SVG path → polygons ─────────────────────────────────────────────────────
def parse_path(d):
    """Flatten an absolute SVG path (M/L/H/V/C/Z) into a list of polygons."""
    tokens = re.findall(r'[MmLlHhVvCcZz]|-?\d*\.?\d+(?:e-?\d+)?', d)
    polys, pts = [], []
    x = y = sx = sy = 0.0
    i, cmd = 0, None

    def num():
        nonlocal i
        v = float(tokens[i]); i += 1
        return v

    while i < len(tokens):
        if tokens[i].isalpha():
            cmd = tokens[i]; i += 1
            if cmd in 'Zz':
                if pts:
                    polys.append(pts); pts = []
                x, y = sx, sy
                continue
        rel = cmd.islower()
        c = cmd.upper()
        if c == 'M':
            x, y = num(), num()
            if rel: x, y = x + sx, y + sy
            if pts: polys.append(pts)
            pts = [(x, y)]
            sx, sy = x, y
            cmd = 'l' if rel else 'L'          # subsequent pairs are lineto
        elif c == 'L':
            nx, ny = num(), num()
            if rel: nx, ny = x + nx, y + ny
            x, y = nx, ny; pts.append((x, y))
        elif c == 'H':
            nx = num()
            x = x + nx if rel else nx; pts.append((x, y))
        elif c == 'V':
            ny = num()
            y = y + ny if rel else ny; pts.append((x, y))
        elif c == 'C':
            x1, y1, x2, y2, nx, ny = (num() for _ in range(6))
            if rel:
                x1, y1, x2, y2, nx, ny = x+x1, y+y1, x+x2, y+y2, x+nx, y+ny
            # flatten the cubic; 24 steps is well under a pixel at 2048px wide
            for k in range(1, 25):
                t = k / 24.0
                m = 1 - t
                pts.append((
                    m*m*m*x + 3*m*m*t*x1 + 3*m*t*t*x2 + t*t*t*nx,
                    m*m*m*y + 3*m*m*t*y1 + 3*m*t*t*y2 + t*t*t*ny,
                ))
            x, y = nx, ny
    if pts:
        polys.append(pts)
    return polys


def leaf_mask(polys, dim, scale, ox, oy):
    """Nonzero-winding scanline fill at supersample resolution.

    Returns `dim` rows of `dim` bytes (1 = inside), matching SVG's default
    fill-rule so the vein cut-out stays open.
    """
    edges = []
    for poly in polys:
        for j in range(len(poly)):
            x0, y0 = poly[j]
            x1, y1 = poly[(j + 1) % len(poly)]
            if y0 == y1:
                continue
            edges.append((x0*scale + ox, y0*scale + oy,
                          x1*scale + ox, y1*scale + oy))

    rows = []
    for py in range(dim):
        yc = py + 0.5
        hits = []
        for x0, y0, x1, y1 in edges:
            if (y0 <= yc < y1) or (y1 <= yc < y0):
                t = (yc - y0) / (y1 - y0)
                hits.append((x0 + t * (x1 - x0), 1 if y1 > y0 else -1))
        row = bytearray(dim)
        if hits:
            hits.sort()
            wind = 0
            for k in range(len(hits) - 1):
                wind += hits[k][1]
                if wind != 0:
                    a = max(0, min(dim, int(math.ceil(hits[k][0] - 0.5))))
                    b = max(0, min(dim, int(math.ceil(hits[k+1][0] - 0.5))))
                    for xx in range(a, b):
                        row[xx] = 1
        rows.append(row)
    return rows


# ── backgrounds ─────────────────────────────────────────────────────────────
def bg_test(style, dim):
    r2 = (dim / 2.0) ** 2
    inset_r2 = (dim * 0.40) ** 2
    c = dim / 2.0
    if style == 'square':
        return lambda x, y: True
    if style == 'circle':
        return lambda x, y: (x - c) ** 2 + (y - c) ** 2 <= r2
    return lambda x, y: (x - c) ** 2 + (y - c) ** 2 <= inset_r2   # 'inset'


def render(size, style, leaf_frac, polys):
    dim = size * SS
    target = dim * leaf_frac
    scale = target / VB
    off = (dim - target) / 2.0
    mask = leaf_mask(polys, dim, scale, off, off)
    inside_bg = bg_test(style, dim)

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                fy = y * SS + sy
                mrow = mask[fy]
                for sx in range(SS):
                    fx = x * SS + sx
                    if inside_bg(fx + 0.5, fy + 0.5):
                        cr, cg, cb = WHITE if mrow[fx] else GREEN
                        r += cr; g += cg; b += cb; a += 255
            n = SS * SS
            if a == 0:
                row += bytes((0, 0, 0, 0))
            else:
                cnt = a // 255
                row += bytes((r // cnt, g // cnt, b // cnt, a // n))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    print(f"  {os.path.basename(path):24} {size:>3}px  {len(png)/1024:5.1f} KB")


if __name__ == '__main__':
    svg = open(os.path.join(HERE, 'leaf.svg')).read()
    d = re.search(r'\sd="([^"]+)"', svg).group(1)
    polys = parse_path(d)
    print(f"leaf.svg: {len(polys)} subpath(s), {sum(len(p) for p in polys)} points")
    for name, size, style, frac in ICONS:
        write_png(os.path.join(HERE, name), size, render(size, style, frac, polys))
