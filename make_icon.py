# -*- coding: utf-8 -*-
"""生成应用图标 app.ico（纯标准库，无第三方依赖）"""
import struct
import zlib

SIZES = [256, 128, 64, 48, 32, 16]
SS = 4  # 超采样倍数

BG = (13, 18, 26, 255)
BORDER = (36, 48, 64, 255)
UP = (246, 70, 93, 255)
DOWN = (14, 203, 129, 255)
GOLD = (224, 177, 85, 255)
GOLD_SOFT = (224, 177, 85, 70)


def blend(dst, src):
    a = src[3] / 255.0
    return (
        int(src[0] * a + dst[0] * (1 - a)),
        int(src[1] * a + dst[1] * (1 - a)),
        int(src[2] * a + dst[2] * (1 - a)),
        255,
    )


def seg_dist(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return ((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2) ** 0.5


def render(size):
    S = size * SS
    pix = [(0, 0, 0, 0)] * (S * S)

    rad = S * 0.23
    pad = S * 0.03
    for y in range(S):
        for x in range(S):
            # 圆角矩形遮罩
            cx = min(max(x, pad + rad), S - pad - rad)
            cy = min(max(y, pad + rad), S - pad - rad)
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            inside = (pad <= x <= S - pad and pad <= y <= S - pad and d <= rad)
            if not inside:
                continue
            edge = d > rad - S * 0.012
            pix[y * S + x] = BORDER if edge else BG

    # 均线（金色折线）
    pts = [(0.20, 0.70), (0.40, 0.52), (0.58, 0.60), (0.80, 0.30)]
    pts = [(x * S, y * S) for x, y in pts]
    lw = S * 0.021
    for y in range(S):
        for x in range(S):
            if pix[y * S + x][3] == 0:
                continue
            for i in range(len(pts) - 1):
                if seg_dist(x, y, *pts[i], *pts[i + 1]) <= lw:
                    pix[y * S + x] = blend(pix[y * S + x], GOLD_SOFT)
                    break

    # 蜡烛
    candles = [
        (0.235, 0.46, 0.76, DOWN),   # x, top, bottom, color
        (0.425, 0.30, 0.66, UP),
        (0.615, 0.42, 0.72, DOWN),
        (0.805, 0.18, 0.52, UP),
    ]
    body_w = S * 0.095
    wick_w = S * 0.022
    for cxr, top, bot, col in candles:
        cx = cxr * S
        y0, y1 = top * S, bot * S
        # 影线
        wy0, wy1 = y0 - S * 0.06, y1 + S * 0.06
        for y in range(int(max(0, wy0)), int(min(S, wy1))):
            for x in range(int(cx - wick_w / 2), int(cx + wick_w / 2) + 1):
                if 0 <= x < S and pix[y * S + x][3] != 0:
                    pix[y * S + x] = col
        # 实体
        for y in range(int(y0), int(y1)):
            for x in range(int(cx - body_w / 2), int(cx + body_w / 2)):
                if 0 <= x < S and 0 <= y < S and pix[y * S + x][3] != 0:
                    pix[y * S + x] = col

    # 下采样
    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            n = 0
            for dy in range(SS):
                for dx in range(SS):
                    p = pix[(y * SS + dy) * S + (x * SS + dx)]
                    if p[3]:
                        r += p[0]; g += p[1]; b += p[2]; a += p[3]
                        n += 1
            k = y * size * 4 + x * 4
            if n:
                out[k] = r // n
                out[k + 1] = g // n
                out[k + 2] = b // n
                out[k + 3] = a // n
    return bytes(out)


def png(w, h, rgba):
    raw = b''.join(b'\x00' + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))
    comp = zlib.compress(raw, 9)

    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
            chunk(b'IDAT', comp) + chunk(b'IEND', b''))


def main():
    pngs = []
    for s in SIZES:
        pngs.append(png(s, s, render(s)))
    n = len(SIZES)
    head = struct.pack('<HHH', 0, 1, n)
    off = 6 + 16 * n
    dirs = b''
    for s, p in zip(SIZES, pngs):
        w = 0 if s >= 256 else s
        dirs += struct.pack('<BBBBHHII', w, w, 0, 0, 1, 32, len(p), off)
        off += len(p)
    with open('app.ico', 'wb') as f:
        f.write(head + dirs + b''.join(pngs))
    print('app.ico 已生成，共 %d 种尺寸' % n)


if __name__ == '__main__':
    main()
