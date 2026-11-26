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


def warm_lights(v, s, hue, vmin=0.78, region=None):
    m = sm(v, vmin - 0.06, vmin + 0.08) * sm(s, 0.3, 0.5) * ((hue > 15) & (hue < 60))
    m = m * (region if region is not None else 1)
    return cv2.GaussianBlur(m, (0, 0), 1.2)
def small_blobs(m, k=9):
    """Keep only small bright spots (candles, bulbs, engines): top-hat on the mask."""
    g = (np.clip(m, 0, 1) * 255).astype(np.uint8)
    t = cv2.morphologyEx(g, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))).astype(np.float32) / 255
    return np.clip(t * 2.2, 0, 1)

def vault(bgr, dep, hue, s, v):
    candles = small_blobs(warm_lights(v, s, hue, 0.8), 13) * (1 - box(380, 0, 650, 110, 8))
    shaft = poly([(470, 80), (560, 80), (640, 330), (390, 330)], 25)
    wheel = ell(512, 265, 95, 95, 10) * sm(v, 0.55, 0.8)
    lamp = warm_lights(v, s, hue, 0.85, box(120, 360, 230, 440, 4) + box(830, 360, 910, 440, 4))
    A = np.maximum.reduce([candles, wheel * 0.5, lamp * 0.8])
    return dict(B=shaft * 0.8 * sm(v, 0.5, 0.8) + ell(512, 40, 110, 40, 10) * 0.3, A=A)

def operations(bgr, dep, hue, s, v):
    cyan = ((hue > 160) & (hue < 205)) * sm(s, 0.3, 0.5) * sm(v, 0.6, 0.8)
    ring = cv2.GaussianBlur(cyan * ell(430, 355, 420, 230, 6), (0, 0), 1.0)
    globe = ell(510, 190, 88, 88, 6) * sm(v, 0.45, 0.7)
    lights = warm_lights(v, s, hue, 0.8) * (1 - ell(510, 300, 340, 190, 6))
    earth = (1 - sm(dep, 0.35, 0.55)) * (1 - ell(430, 340, 440, 260, 30)) * 0.9
    return dict(B=cv2.GaussianBlur(earth, (0, 0), 6), A=np.maximum.reduce([ring * 0.9, globe * 0.8, lights * 0.7]))

def business(bgr, dep, hue, s, v):
    cyan = ((hue > 170) & (hue < 215)) * sm(s, 0.3, 0.5) * sm(v, 0.7, 0.9)
    lights = np.maximum(small_blobs(cv2.GaussianBlur(cyan, (0, 0), 1.0), 9), small_blobs(warm_lights(v, s, hue, 0.82), 11))
    planet = box(0, 10, 520, 260, 20) * (1 - sm(dep, 0.4, 0.6))
    sky = box(560, 0, 1024, 150, 20) * (1 - sm(dep, 0.25, 0.4)) * 0.4
    return dict(B=cv2.GaussianBlur(np.maximum(planet, sky), (0, 0), 5) * 0.9, A=lights)

def agents(bgr, dep, hue, s, v):
    scr = np.maximum.reduce([box(80, 72, 265, 207, 3), box(760, 72, 945, 207, 3), box(300, 345, 720, 415, 3), box(110, 255, 200, 330, 3), box(840, 255, 930, 330, 3)]) * sm(v, 0.45, 0.7)
    globe = ell(510, 170, 105, 105, 6) * sm(v, 0.45, 0.7)
    rings = ell(510, 20, 230, 40, 6) * sm(v, 0.7, 0.9)
    return dict(A=np.maximum.reduce([scr * 0.9, globe * 0.8, rings * 0.5]))

def analytics(bgr, dep, hue, s, v):
    bright = sm(v, 0.7, 0.9) * sm(s, 0.2, 0.5) * ((hue > 190) & (hue < 235))
    peaks = cv2.GaussianBlur(bright, (0, 0), 1.2) * box(0, 0, 1024, 573, 0)
    # beams: tall thin bright structures in the upper part; particles rise along them (flow upward, see FX.flowDir)
    beam = cv2.morphologyEx((bright * box(0, 0, 1024, 330, 4) > 0.5).astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 25)))
    beam = cv2.GaussianBlur(cv2.dilate(beam, np.ones((1, 3), np.uint8)).astype(np.float32), (0, 0), 1.2)
    return dict(R=beam * 0.9, A=np.maximum(peaks * 0.7, beam * 0.5), B=box(0, 0, 1024, 140, 25) * (1 - sm(v, 0.2, 0.4)) * 0.6)

def studio(bgr, dep, hue, s, v):
    screens = np.maximum.reduce([box(60, 62, 300, 267, 3), box(770, 77, 980, 257, 3), box(320, 127, 760, 277, 3), box(690, 312, 980, 407, 3)]) * sm(v, 0.3, 0.6)
    red = ((hue < 20) | (hue > 340)) * sm(s, 0.5, 0.7) * sm(v, 0.75, 0.95) * box(0, 0, 1024, 80, 4)
    return dict(A=np.maximum(screens * 0.85, cv2.GaussianBlur(red, (0, 0), 1.0) * 0.5))

def core(bgr, dep, hue, s, v):
    return dict(B=sky_drift(dep, None, 0.2, 0.4) * 0.8 + (1 - ell(510, 255, 230, 230, 12)) * box(520, 0, 1024, 260, 30) * 0.6, A=small_blobs(sm(v, 0.8, 0.95) * sm(s, 0.1, 0.4), 7) * 0.7)

def zoom_generic(bgr, dep, hue, s, v):
    return dict(B=sky_drift(dep, None, 0.2, 0.38) * 0.7, A=small_blobs(sm(v, 0.8, 0.95) * sm(s, 0.2, 0.5), 11) * 0.8)

CFG = dict(life=life, gamedev=gamedev, memory=memory, arch=arch, vault=vault, operations=operations, business=business, agents=agents, analytics=analytics, studio=studio, core=core)
for _z in ['vault', 'operations', 'business', 'agents', 'memory', 'analytics', 'studio']: CFG['zoom-' + _z] = zoom_generic

if __name__ == "__main__":
    for id in (sys.argv[1:] or [k for k in CFG if k not in ('life','gamedev','memory','arch')]): build(id)
