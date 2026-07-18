#!/usr/bin/env python3
"""Generate Abridged PWA icons (pure stdlib PNG writer, 4x supersampled)."""
import math, struct, zlib, os

OUT = os.path.dirname(os.path.abspath(__file__))
GREEN = (46, 75, 60)      # #2E4B3C
WHITE = (255, 255, 255)
SS = 4                    # supersample factor


def rounded_rect(x, y, w, h, r):
    """Signed coverage test for a rounded rect in unit-ish space."""
    def inside(px, py):
        dx = max(x - px, 0, px - (x + w))
        dy = max(y - py, 0, py - (y + h))
        if dx > 0 and dy > 0:
            return False
        # corner rounding
        cx = min(max(px, x + r), x + w - r)
        cy = min(max(py, y + r), y + h - r)
        ddx, ddy = px - cx, py - cy
        if abs(ddx) > 0 and abs(ddy) > 0:
            return ddx * ddx + ddy * ddy <= r * r
        return x <= px <= x + w and y <= py <= y + h
    return inside


def leaf_shape(cx, cy, height, angle=math.pi / 4):
    """Vesica-piscis leaf with a tapered central vein, rotated by `angle`."""
    s = height / 1.036          # the lens spans ~1.036*s along its long axis
    r = s * 0.62
    d = s * 0.34
    half_len = math.sqrt(r * r - d * d)
    ca, sa = math.cos(-angle), math.sin(-angle)

    def inside(px, py):
        # rotate point into leaf-local space (long axis = ly)
        ux, uy = px - cx, py - cy
        lx = ux * ca - uy * sa
        ly = ux * sa + uy * ca
        if (lx + d) ** 2 + ly ** 2 > r * r:
            return False
        if (lx - d) ** 2 + ly ** 2 > r * r:
            return False
        # carve the vein: a slit down the long axis, tapering toward both tips
        t = abs(ly) / half_len
        vein = s * 0.05 * (1.0 - t) ** 0.5
        return abs(lx) > vein
    return inside


def render(size, maskable):
    px = size * SS
    if maskable:
        # full bleed background, artwork inside the 80% safe zone
        bg = rounded_rect(0, 0, px, px, 0)
        leaf = leaf_shape(px / 2, px / 2, px * 0.40)
    else:
        bg = rounded_rect(0, 0, px, px, px * 0.5)   # circle, like the app logo
        leaf = leaf_shape(px / 2, px / 2, px * 0.54)

    # supersampled accumulation
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    fx = x * SS + sx + 0.5
                    fy = y * SS + sy + 0.5
                    if bg(fx, fy):
                        if leaf(fx, fy):
                            cr, cg, cb = WHITE
                        else:
                            cr, cg, cb = GREEN
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
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print(f"  {os.path.basename(path)}  {len(png)/1024:.1f} KB")


os.makedirs(OUT, exist_ok=True)
for size in (180, 192, 512):
    write_png(f"{OUT}/icon-{size}.png", size, render(size, maskable=False))
for size in (192, 512):
    write_png(f"{OUT}/icon-{size}-maskable.png", size, render(size, maskable=True))
