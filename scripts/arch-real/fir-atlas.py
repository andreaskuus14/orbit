#!/usr/bin/env python3
"""Turns fir-bake.mjs's 2048 px render into public/worlds/textures/fir_impostors.webp: 4x supersampled down to 1024 px with premultiplied alpha (so the
needles keep their coverage instead of vanishing), colour bled out into the transparent edge (no dark fringes when the card is filtered). usage: fir-atlas.py <raw.png> <out.webp>"""
import sys
import numpy as np
from PIL import Image
im = np.array(Image.open(sys.argv[1]).convert("RGBA")).astype(np.float32) / 255
a = im[..., 3:4]; pre = im[..., :3] * a
def down(x): h, w = x.shape[:2]; return x.reshape(h // 2, 2, w // 2, 2, -1).mean((1, 3))
pre, a = down(down(pre)), down(down(a))
col = np.where(a > 1e-3, pre / np.maximum(a, 1e-3), 0)
# bleed: repeat a few times, pull colour from neighbours into pixels with no coverage
have = a[..., 0] > 0.02
for _ in range(6):
    acc = np.zeros_like(col); cnt = np.zeros(have.shape, np.float32)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        h = np.roll(have, (dy, dx), (0, 1)); c = np.roll(col, (dy, dx), (0, 1)); acc += c * h[..., None]; cnt += h
    fill = ~have & (cnt > 0); col[fill] = acc[fill] / cnt[fill][:, None]; have = have | fill
out = np.concatenate([np.clip(col, 0, 1), a], -1)
Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA").save(sys.argv[2], "WEBP", quality=86, method=6, exact=True)
