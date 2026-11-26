#!/usr/bin/env python3
"""Offline mask of the painted glow network (cyan/teal arcs, coast lines, road glow) on the Intelligence plates.
python3 scripts/frame-scenes/lines.py [id ...]  ->  public/ui/frames/<id>-lines.png, greyscale, 672 px wide:
  value 255 = a thin bright cyan/teal line, ~96 = the soft halo around it (so plate-gl can knock both down).
Thin-structure filter: a white top-hat keeps only features narrower than the kernel, so lakes, sea and big glows are left alone.
City lights (warm hue) are never in the mask. No model is called."""
import sys, os, numpy as np, cv2
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
UI = os.path.join(ROOT, "public", "ui", "frames")
OW = 672
def sm(x, a, b): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def build(id, tophat=11, vmin=0.62):
    bgr = cv2.imread(os.path.join(UI, f"{id}.jpg")); h, w = bgr.shape[:2]
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32); hue, s, v = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    cyan = ((hue > 160) & (hue < 205)).astype(np.float32) * sm(s, 0.18, 0.4) * sm(v, vmin - 0.1, vmin + 0.1)
    # brightness of the cyan part only, then keep thin bright structure
    g = (cyan * v * 255).astype(np.uint8)
    th = cv2.morphologyEx(g, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (tophat, tophat))).astype(np.float32) / 255
    line = np.clip(th * 3.0, 0, 1) * (cyan > 0.3)
    line = cv2.GaussianBlur(line, (0, 0), 0.8)
    halo = cv2.GaussianBlur(cv2.dilate(line, np.ones((5, 5), np.uint8)), (0, 0), 5)
    out = np.maximum(line, np.clip(halo * 0.9, 0, 0.38))
    out = cv2.resize(out, (OW, int(h * OW / w)), interpolation=cv2.INTER_AREA)
    png = os.path.join(UI, f"{id}-lines.png"); cv2.imwrite(png, (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))
    dbg = bgr.astype(np.float32) * 0.5; m = cv2.resize(out, (w, h)); dbg[..., 2] += m * 255
    os.makedirs("/tmp/ic", exist_ok=True); cv2.imwrite(f"/tmp/ic/lines-{id}.jpg", np.clip(dbg, 0, 255).astype(np.uint8))
    print(id, os.path.getsize(png), "bytes, coverage", round(float((out > 0.5).mean()) * 100, 2), "%")
if __name__ == "__main__":
    for i in (sys.argv[1:] or ["world", "europe", "estonia", "tallinn", "village"]): build(i)
