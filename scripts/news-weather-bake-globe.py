#!/usr/bin/env python3
"""Bakes public/ui/relief/globe-4096.jpg, the News weather globe texture, from two public-domain Natural Earth rasters
(naturalearthdata.com, "all versions of Natural Earth raster + vector map data are in the public domain"):
  NE1_50M_SR_W.tif  Natural Earth I with shaded relief and water   (naciscdn.org/naturalearth/50m/raster/NE1_50M_SR_W.zip)
  OB_50M.tif        ocean bottom shaded relief                      (naciscdn.org/naturalearth/50m/raster/OB_50M.zip)
Land keeps its natural greens and tans, darkened for a dark page; the sea becomes a deep blue whose shade follows NE1's own
depth tint, with the ocean-bottom relief laid over it. Run once by hand (needs Pillow + numpy):
  python3 scripts/news-weather-bake-globe.py NE1_50M_SR_W.tif OB_50M.tif public/ui/relief/globe-4096.jpg
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
ne_path, ob_path, out = sys.argv[1:4]
W, H = 4096, 2048
ne = np.asarray(Image.open(ne_path).convert("RGB").resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
ob = np.asarray(Image.open(ob_path).convert("L").resize((W, H), Image.LANCZOS)).astype(np.float32)
r, g, b = ne[..., 0], ne[..., 1], ne[..., 2]

# water: NE1 paints it blue (b clearly above r); ice and snow are near-white, so they stay land
water = ((b - r) > 0.07) & (b >= g - 0.02)
m = np.asarray(Image.fromarray((water * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32)[..., None] / 255

# land: darker and quieter, olive and khaki like a satellite mosaic under soft light (NE1's bright yellow-greens toned down)
lum = (0.3 * r + 0.59 * g + 0.11 * b)[..., None]
land = np.clip(lum + (ne - lum) * 0.72, 0, 1) ** 2.0 * np.array([0.98, 0.93, 0.80]) * 0.88

# sea: depth from NE1's blue tint (lighter = shallower), mapped deep navy -> shelf blue, then the sea-floor relief
lw = 0.3 * r + 0.59 * g + 0.11 * b
sea_l = lw[water]
lo, hi = np.percentile(sea_l, 3), np.percentile(sea_l, 97)
t = np.clip((lw - lo) / max(1e-6, hi - lo), 0, 1)[..., None] ** 1.6
deep, shelf = np.array([0.047, 0.106, 0.170]), np.array([0.135, 0.285, 0.365])
sea = deep + (shelf - deep) * t
mode = np.bincount(ob.astype(np.int32).ravel()).argmax()
sea = np.clip(sea * (1 + 0.9 * (ob[..., None] / mode - 1)), 0, 1)

img = land * (1 - m) + sea * m
Image.fromarray((img * 255 + 0.5).astype(np.uint8)).save(out, quality=82, optimize=True, progressive=True)
print(out, W, H)
