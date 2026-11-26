#!/usr/bin/env python3
"""Offline effect masks for the frame plates (run by hand: python3 scripts/frame-scenes/fx.py [id ...]).
Writes public/worlds/frames/<id>-fx.png, 512x287 RGBA, read by FrameScene's shader and decoded in src/lib/frame-fx-pure.ts:
  R  water: 0.55..1 waterfall (flows down), 0.08..0.5 pond/lake (ripples)
  G  foliage sway weight (0 at the base of a plant .. 1 at its tip)
  B  cloud / nebula / smoke drift
  A  emissive: lamps, fire, neon, crystals (stored as 0.25 + 0.75 * v so the PNG never loses RGB to premultiplied alpha)
Heuristics: colour / brightness / depth (Depth Anything V2 map, far = sky) inside hand-set polygons. Coordinates below are
read off a 1024x573 preview of each plate. Nothing here leaves the machine; no model is called."""
import sys, os, numpy as np, cv2
from scipy import ndimage as ndi

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FR = os.path.join(ROOT, "public", "worlds", "frames")
W, H, OW, OH = 1024, 573, 512, 287

def poly(pts, soft=6):
    m = np.zeros((H, W), np.float32); cv2.fillPoly(m, [np.array(pts, np.int32)], 1.0)
    return cv2.GaussianBlur(m, (0, 0), soft) if soft else m
def box(x0, y0, x1, y1, soft=6): return poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], soft)
def ell(cx, cy, rx, ry, soft=8):
    m = np.zeros((H, W), np.float32); cv2.ellipse(m, (cx, cy), (rx, ry), 0, 0, 360, 1.0, -1)
    return cv2.GaussianBlur(m, (0, 0), soft) if soft else m
def union(ms):
    o = np.zeros((H, W), np.float32)
    for m in ms: o = np.maximum(o, m)
    return o
def sm(x, a, b): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def load(id):
    bgr = cv2.resize(cv2.imread(os.path.join(FR, f"{id}.webp")), (W, H), interpolation=cv2.INTER_AREA)
    dep = cv2.resize(cv2.imread(os.path.join(FR, f"{id}-depth.webp"), 0), (W, H)).astype(np.float32) / 255
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    return bgr, dep, hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255  # hue degrees, s, v

def streaks(score, k=21):
    """Keep only tall thin structures (waterfalls): open with a tall kernel, then grow a little."""
    b = (score > 0.5).astype(np.uint8)
    b = cv2.morphologyEx(b, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (3, k)))
    return cv2.GaussianBlur(b.astype(np.float32), (0, 0), 2.0)

def foliage_weight(m, tip_pow=0.9):
    """Per connected plant: 0 at its lowest pixel, 1 at its top, so the base stays rooted and the tip moves most."""
    lab, n = ndi.label(m > 0.35); out = np.zeros_like(m)
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        if sl is None: continue
        ys = np.arange(sl[0].start, sl[0].stop)[:, None]; reg = lab[sl] == i
        if reg.sum() < 40: continue
        y0, y1 = sl[0].start, sl[0].stop
        g = np.clip((y1 - ys) / max(1, (y1 - y0)), 0, 1) ** tip_pow
        g = 0.25 + 0.75 * g
        out[sl] = np.where(reg, np.maximum(out[sl], g * m[sl]), out[sl])
    return out

def gradient_in(region_box, m, tip_pow=0.8):
    x0, y0, x1, y1 = region_box
    ys = np.clip((y1 - np.arange(H, dtype=np.float32)) / max(1, y1 - y0), 0, 1)[:, None] ** tip_pow
    return m * (0.2 + 0.8 * ys)

def build(id):
    bgr, dep, hue, s, v = load(id); cfg = CFG[id](bgr, dep, hue, s, v)
    R, G, B, A = [np.clip(cfg.get(k, np.zeros((H, W), np.float32)), 0, 1) for k in "RGBA"]
    A = 0.25 + 0.75 * A
    out = np.dstack([R, G, B, A])
    out = cv2.resize(out, (OW, OH), interpolation=cv2.INTER_AREA)
    rgba = (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)
    png = os.path.join(FR, f"{id}-fx.png"); cv2.imwrite(png, cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    # debug overlay in /tmp: R red, G green, B blue, emissive white
    dbg = bgr.astype(np.float32) * 0.55
    for c, ch in ((2, cfg.get("R")), (1, cfg.get("G")), (0, cfg.get("B"))):
        if ch is not None: dbg[..., c] += np.clip(ch, 0, 1) * 200
    if cfg.get("A") is not None: dbg += np.clip(cfg["A"], 0, 1)[..., None] * 160
    os.makedirs("/tmp/alive", exist_ok=True); cv2.imwrite(f"/tmp/alive/fx-{id}.jpg", np.clip(dbg, 0, 255).astype(np.uint8))
    print(id, os.path.getsize(png), "bytes")

def waterfalls(boxes, hue, s, v, vmin=0.62, smax=0.55):
    reg = union([box(*b, soft=3) for b in boxes])
    light = sm(v, vmin - 0.08, vmin + 0.1) * sm(smax, s - 0.05, s + 0.12) if False else sm(v, vmin - 0.08, vmin + 0.1) * (1 - sm(s, smax - 0.1, smax + 0.15))
    return streaks(light * reg, 15) * 0.9 + 0.1 * reg * light

def sky_drift(dep, hint=None, lo=0.28, hi=0.42):
    m = 1 - sm(dep, lo, hi)
    if hint is not None: m = m * hint
    return cv2.GaussianBlur(m, (0, 0), 5)

def emissive(v, s, hue, regions, vmin=0.8, smin=0.0, hue_rng=None):
    reg = union(regions); m = sm(v, vmin - 0.06, vmin + 0.08) * sm(s, smin - 0.1, smin + 0.1)
    if hue_rng: a, b = hue_rng; m = m * ((hue >= a) & (hue <= b))
    return cv2.GaussianBlur(m * reg, (0, 0), 1.5)

# ---- per plate ---------------------------------------------------------------------------------------------------------
def life(bgr, dep, hue, s, v):
    falls = [(150, 290, 190, 445), (425, 355, 575, 545), (790, 310, 835, 460), (150, 95, 172, 170), (890, 150, 912, 190)]
    R = waterfalls(falls, hue, s, v, 0.6, 0.5)
    pond = ell(600, 328, 70, 20, 6) * 0.3
    R = np.maximum(R, pond)
    crown = poly([(235, 190), (260, 140), (320, 112), (400, 105), (470, 125), (520, 190), (500, 235), (430, 240), (340, 235), (280, 235)], 10)
    blossom = crown * sm(s, 0.1, 0.25) * (1 - sm(hue, 100, 140)) * sm(v, 0.5, 0.7)
    wist = poly([(655, 185), (740, 180), (735, 235), (690, 245), (660, 225)], 6) * sm(s, 0.12, 0.3)
    smalls = union([ell(80, 72, 28, 14), ell(905, 127, 30, 14), ell(978, 208, 20, 10), ell(82, 395, 28, 14), ell(900, 425, 30, 14), ell(190, 80, 8, 10)]) * (hue > 60) 
    ex = union([box(500, 20, 720, 200, 4), box(440, 70, 515, 140, 4), box(150, 140, 260, 235, 4), box(738, 150, 862, 262, 4)])  # glass domes stay rigid
    green = sm(s, 0.18, 0.35) * ((hue > 70) & (hue < 170)) * (dep > 0.45) * (1 - ex) * box(60, 250, 960, 520, 8)
    pink_bush = sm(s, 0.2, 0.4) * ((hue > 300) | (hue < 20)) * box(260, 300, 760, 380, 8) * sm(v, 0.5, 0.7)
    fol = np.clip(np.maximum.reduce([blossom, wist * 0.8, smalls * 0.6, green, pink_bush * 0.7]), 0, 1)
    G = foliage_weight(cv2.GaussianBlur(fol, (0, 0), 1.2))
    G = np.maximum(G, 0)
    B = np.maximum(sky_drift(dep, box(0, 330, 1024, 573, 20), 0.35, 0.55) * 0.9, sky_drift(dep, box(0, 0, 1024, 90, 20), 0.2, 0.4) * 0.7)
    lan = [ell(235, 283, 7, 9, 2), ell(266, 291, 7, 9, 2), ell(396, 313, 7, 9, 2), ell(746, 284, 7, 9, 2), ell(910, 262, 7, 9, 2)]
    A = emissive(v, s, hue, lan, 0.7, 0.1) * 1.2 + 0.0
    return dict(R=R, G=G, B=B, A=A)

def gamedev(bgr, dep, hue, s, v):
    falls = [(495, 385, 575, 560), (525, 200, 548, 275), (568, 200, 592, 262), (72, 305, 98, 390), (788, 370, 812, 455), (940, 280, 962, 335), (968, 372, 985, 410), (95, 440, 112, 495), (905, 440, 922, 470), (50, 160, 66, 205), (895, 125, 905, 160)]
    R = waterfalls(falls, hue, s, v, 0.62, 0.8)
    cyan = ((hue > 160) & (hue < 205)) * sm(s, 0.3, 0.5) * sm(v, 0.55, 0.75)
    river = union([box(425, 295, 530, 345, 4), box(420, 295, 470, 335, 4)]) * cyan
    R = np.maximum(R, cv2.GaussianBlur(river, (0, 0), 2) * 0.3)
    wheat = poly([(160, 225), (290, 215), (300, 255), (165, 262)], 5) * sm(s, 0.35, 0.55) * ((hue > 30) & (hue < 60))
    crown = poly([(130, 335), (170, 305), (240, 292), (320, 305), (355, 335), (330, 375), (200, 385), (140, 370)], 8) * sm(s, 0.2, 0.4) * ((hue > 290) | (hue < 20))
    ex = union([box(420, 90, 600, 205, 4), box(630, 70, 940, 250, 4), box(620, 130, 700, 215, 4)])
    green = ((hue > 70) & (hue < 160)) * sm(s, 0.25, 0.45) * (1 - ex) * box(15, 190, 1000, 500, 10) * (1 - cyan)
    fol = np.clip(np.maximum.reduce([wheat * 0.8, crown, green]), 0, 1)
    G = foliage_weight(cv2.GaussianBlur(fol, (0, 0), 1.0))
    aurora = poly([(0, 0), (340, 0), (320, 70), (200, 95), (0, 40)], 18)
    smoke = ell(685, 75, 55, 40, 12)
    nebula = box(800, 0, 1024, 120, 16)
    B = np.maximum.reduce([sky_drift(dep, None, 0.18, 0.34) * (box(0, 0, 1024, 140, 25) + box(0, 440, 1024, 573, 25)).clip(0, 1) * 0.8, aurora * 0.6, smoke * 0.7, nebula * 0.4])
    city = poly([(640, 85), (940, 70), (940, 250), (640, 250)], 6)
    neon = emissive(v, s, hue, [city], 0.78, 0.35)
    lan = emissive(v, s, hue, [box(130, 300, 360, 400, 4), box(280, 215, 420, 290, 4), box(80, 190, 170, 235, 3)], 0.75, 0.3, (10, 70))
    crys = emissive(v, s, hue, [box(385, 440, 445, 505, 3), box(600, 440, 650, 495, 3), box(60, 395, 95, 425, 3), box(980, 400, 1000, 420, 3), box(720, 290, 840, 340, 3)], 0.7, 0.3, (170, 300))
    A = np.maximum.reduce([neon, lan, crys])
    return dict(R=R, G=G, B=B, A=A)

def memory(bgr, dep, hue, s, v):
    falls = [(480, 345, 575, 485), (118, 312, 138, 375), (372, 378, 392, 445), (660, 368, 685, 432), (862, 318, 885, 375), (795, 225, 810, 262)]
    R = waterfalls(falls, hue, s, v, 0.62, 0.6)
    ex = box(140, 130, 920, 300, 6)
    treesm = ((hue > 230) & (hue < 320)) * sm(s, 0.2, 0.5) * sm(v, 0.25, 0.5) * (dep > 0.45) * (1 - ex) * box(40, 250, 980, 420, 10) * sm(0.6, v, 0.9)
    dome_tree = poly([(690, 245), (740, 235), (790, 270), (770, 300), (700, 300)], 6) * sm(s, 0.15, 0.4) * sm(v, 0.5, 0.7)
    G = foliage_weight(cv2.GaussianBlur(np.maximum(treesm * 0.7, dome_tree * 0.8), (0, 0), 1.0))
    B = sky_drift(dep, None, 0.3, 0.5) * 0.95
    gold = ((hue > 15) & (hue < 55)) * sm(s, 0.35, 0.6) * sm(v, 0.7, 0.9)
    beams = cv2.GaussianBlur(gold * box(200, 110, 860, 290, 4), (0, 0), 1.2)
    cry = emissive(v, s, hue, [box(0, 0, 1024, 573, 0)], 0.82, 0.25, (255, 300)) * (dep < 0.9)
    cry = cv2.GaussianBlur(cry, (0, 0), 1.5)
    A = np.maximum(beams * 0.9, cry)
    return dict(R=R, G=G, B=B, A=A)

def arch(bgr, dep, hue, s, v):
    pines = [poly([(0, 0), (380, 0), (360, 55), (250, 130), (120, 175), (60, 180), (0, 150)], 8),  # big foreground pine crown
             poly([(40, 100), (200, 95), (350, 150), (330, 190), (40, 180)], 8),
             poly([(825, 340), (880, 300), (930, 360), (975, 330), (1024, 400), (1024, 500), (830, 480)], 8),
             poly([(190, 100), (310, 100), (350, 165), (215, 170)], 6)]
    treem = np.zeros((H, W), np.float32)
    for p in pines: treem = np.maximum(treem, p)
    notsky = 1 - sm(v, 0.78, 0.95) * sm(0.35, s, 0.1)
    G = gradient_in((0, 0, 1024, 480), treem * notsky * (dep < 0.75), 0.9)
    heather = ((hue > 280) | (hue < 20)) * sm(s, 0.25, 0.45) * box(0, 440, 1024, 573, 10) * sm(v, 0.3, 0.6)
    G = np.maximum(G, gradient_in((0, 440, 1024, 573), cv2.GaussianBlur(heather, (0, 0), 2) * 0.55, 0.5))
    lake = poly([(822, 318), (1024, 330), (1024, 440), (880, 400), (822, 380)], 4) * sm(v, 0.2, 0.5) * (1 - sm(dep, 0.3, 0.5))
    R = lake * 0.3
    sky = poly([(430, 0), (1024, 0), (1024, 235), (800, 215), (700, 170), (430, 90)], 14)
    B = sky_drift(dep, sky, 0.12, 0.3) * 0.9
    warm = ((hue > 10) & (hue < 50)) * sm(v, 0.78, 0.95) * sm(s, 0.3, 0.6)
    lamps = [ell(355, 388, 40, 22, 3), ell(615, 345, 35, 22, 3), ell(140, 400, 18, 24, 3), ell(55, 408, 8, 12, 2), ell(440, 495, 8, 14, 2), ell(665, 505, 8, 14, 2), ell(930, 470, 8, 14, 2),
             ell(535, 248, 45, 52, 4), ell(570, 243, 28, 28, 3), ell(520, 283, 22, 22, 3), ell(215, 320, 60, 40, 4), ell(750, 330, 40, 40, 4), ell(500, 290, 30, 20, 3)]
    A = cv2.GaussianBlur(warm * union(lamps), (0, 0), 1.2)
    return dict(R=R, G=G, B=B, A=A)

CFG = dict(life=life, gamedev=gamedev, memory=memory, arch=arch)

if __name__ == "__main__":
    for id in (sys.argv[1:] or CFG): build(id)
