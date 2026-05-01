#!/usr/bin/env python3
import math
import os
import struct
import sys
import zlib


SIZES = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]


def main():
    if len(sys.argv) not in (2, 3):
        print("usage: make_icon.py <iconset-dir> [icns-path]", file=sys.stderr)
        sys.exit(2)

    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    for name, size in SIZES:
        write_png(os.path.join(out_dir, name), render(size), size, size)
    if len(sys.argv) == 3:
        write_icns(out_dir, sys.argv[2])


def render(size):
    pixels = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            set_px(pixels, size, x, y, (0, 0, 0, 0))

    draw_background(pixels, size)
    draw_orbit(pixels, size, 0.50, 0.54, 0.36, 0.19, -28, 0.022, (88, 225, 182, 205))
    draw_orbit(pixels, size, 0.50, 0.54, 0.36, 0.19, 28, 0.022, (98, 217, 245, 185))
    draw_lock(pixels, size)
    draw_token(pixels, size)
    return pixels


def draw_background(pixels, size):
    margin = size * 0.055
    radius = size * 0.215
    for y in range(size):
        for x in range(size):
            alpha = rounded_rect_alpha(x + 0.5, y + 0.5, margin, margin, size - margin, size - margin, radius)
            if alpha <= 0:
                continue
            t = (x + y) / (size * 2)
            base = (
                int(8 + 10 * t),
                int(15 + 20 * t),
                int(14 + 18 * t),
                int(255 * alpha),
            )
            set_px(pixels, size, x, y, base)

    draw_circle(pixels, size, size * 0.74, size * 0.22, size * 0.22, (125, 255, 177, 28))
    draw_circle(pixels, size, size * 0.25, size * 0.82, size * 0.18, (98, 217, 245, 22))
    draw_round_rect(pixels, size, size * 0.055, size * 0.055, size * 0.945, size * 0.945, radius, (125, 255, 177, 36), stroke=size * 0.014)


def draw_lock(pixels, size):
    draw_arc(pixels, size, size * 0.50, size * 0.45, size * 0.19, math.radians(205), math.radians(335), size * 0.052, (237, 247, 240, 235))
    draw_round_rect(pixels, size, size * 0.28, size * 0.42, size * 0.72, size * 0.75, size * 0.075, (18, 27, 24, 248))
    draw_round_rect(pixels, size, size * 0.28, size * 0.42, size * 0.72, size * 0.75, size * 0.075, (125, 255, 177, 190), stroke=size * 0.018)


def draw_token(pixels, size):
    draw_circle(pixels, size, size * 0.50, size * 0.57, size * 0.055, (125, 255, 177, 235))
    draw_round_rect(pixels, size, size * 0.476, size * 0.61, size * 0.524, size * 0.69, size * 0.014, (125, 255, 177, 235))
    draw_circle(pixels, size, size * 0.36, size * 0.36, size * 0.027, (98, 217, 245, 230))
    draw_circle(pixels, size, size * 0.68, size * 0.69, size * 0.022, (230, 195, 107, 220))


def draw_orbit(pixels, size, cx, cy, rx, ry, angle_deg, width, color):
    angle = math.radians(angle_deg)
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    cx *= size
    cy *= size
    rx *= size
    ry *= size
    width *= size

    for y in range(size):
        for x in range(size):
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            xr = dx * cos_a + dy * sin_a
            yr = -dx * sin_a + dy * cos_a
            v = math.sqrt((xr / rx) ** 2 + (yr / ry) ** 2)
            distance = abs(v - 1) * min(rx, ry)
            if distance <= width:
                alpha = smooth(width, width * 0.25, distance)
                blend_px(pixels, size, x, y, with_alpha(color, color[3] * alpha))


def draw_arc(pixels, size, cx, cy, radius, start, end, width, color):
    for y in range(size):
        for x in range(size):
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            angle = math.atan2(dy, dx)
            if angle < 0:
                angle += math.tau
            if start <= angle <= end:
                dist = abs(math.hypot(dx, dy) - radius)
                if dist <= width:
                    alpha = smooth(width, width * 0.18, dist)
                    blend_px(pixels, size, x, y, with_alpha(color, color[3] * alpha))


def draw_circle(pixels, size, cx, cy, radius, color):
    x0 = max(0, int(cx - radius - 2))
    x1 = min(size, int(cx + radius + 2))
    y0 = max(0, int(cy - radius - 2))
    y1 = min(size, int(cy + radius + 2))
    for y in range(y0, y1):
        for x in range(x0, x1):
            dist = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if dist <= radius + 1:
                alpha = smooth(radius, 1, dist)
                blend_px(pixels, size, x, y, with_alpha(color, color[3] * alpha))


def draw_round_rect(pixels, size, x0, y0, x1, y1, radius, color, stroke=0):
    ix0 = max(0, int(x0 - stroke - 2))
    ix1 = min(size, int(x1 + stroke + 2))
    iy0 = max(0, int(y0 - stroke - 2))
    iy1 = min(size, int(y1 + stroke + 2))
    for y in range(iy0, iy1):
        for x in range(ix0, ix1):
            alpha = rounded_rect_alpha(x + 0.5, y + 0.5, x0, y0, x1, y1, radius)
            if stroke:
                inner = rounded_rect_alpha(x + 0.5, y + 0.5, x0 + stroke, y0 + stroke, x1 - stroke, y1 - stroke, max(0, radius - stroke))
                alpha = max(0, alpha - inner)
            if alpha > 0:
                blend_px(pixels, size, x, y, with_alpha(color, color[3] * alpha))


def rounded_rect_alpha(px, py, x0, y0, x1, y1, radius):
    qx = abs(px - (x0 + x1) / 2) - ((x1 - x0) / 2 - radius)
    qy = abs(py - (y0 + y1) / 2) - ((y1 - y0) / 2 - radius)
    outside = math.hypot(max(qx, 0), max(qy, 0))
    inside = min(max(qx, qy), 0)
    distance = outside + inside - radius
    return max(0, min(1, 1 - distance))


def smooth(edge, feather, distance):
    if distance <= edge - feather:
        return 1
    if distance >= edge:
        return 0
    return (edge - distance) / feather


def with_alpha(color, alpha):
    return (color[0], color[1], color[2], max(0, min(255, int(alpha))))


def set_px(pixels, size, x, y, color):
    i = (y * size + x) * 4
    pixels[i:i + 4] = bytes(color)


def blend_px(pixels, size, x, y, color):
    i = (y * size + x) * 4
    sr, sg, sb, sa = color
    if sa <= 0:
        return
    da = pixels[i + 3]
    out_a = sa + da * (255 - sa) // 255
    if out_a == 0:
        return
    for offset, src in enumerate((sr, sg, sb)):
        dst = pixels[i + offset]
        pixels[i + offset] = (src * sa + dst * da * (255 - sa) // 255) // out_a
    pixels[i + 3] = out_a


def write_png(path, pixels, width, height):
    raw = b"".join(b"\x00" + pixels[y * width * 4:(y + 1) * width * 4] for y in range(height))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


def write_icns(iconset_dir, path):
    items = [
        ("icp4", "icon_16x16.png"),
        ("ic11", "icon_16x16@2x.png"),
        ("icp5", "icon_32x32.png"),
        ("ic12", "icon_32x32@2x.png"),
        ("ic07", "icon_128x128.png"),
        ("ic13", "icon_128x128@2x.png"),
        ("ic08", "icon_256x256.png"),
        ("ic14", "icon_256x256@2x.png"),
        ("ic09", "icon_512x512.png"),
        ("ic10", "icon_512x512@2x.png"),
    ]
    chunks = []
    for code, filename in items:
        with open(os.path.join(iconset_dir, filename), "rb") as handle:
            data = handle.read()
        chunks.append(code.encode("ascii") + struct.pack(">I", len(data) + 8) + data)
    body = b"".join(chunks)
    with open(path, "wb") as handle:
        handle.write(b"icns" + struct.pack(">I", len(body) + 8) + body)


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


if __name__ == "__main__":
    main()
