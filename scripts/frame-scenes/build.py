#!/usr/bin/env python3
"""Frame-scene pipeline: for each Higgsfield frame (hf-refs/worlds/<id>.png) make the 2.5D scene assets.
  1. use <id>-clean.png when the owner provides a text-free version, else crop to the UI-free box in boxes.json,
     reflect-pad to 16:10, and inpaint baked text (tesseract) plus manual mask boxes (cv2.inpaint)
  2. depth map with Depth Anything V2 Small (Apache-2.0, ONNX, CPU)
  3. write public/worlds/frames/<id>.webp (colour, 2048 wide) and <id>-depth.webp (512 wide grey)
Usage: python3 -I scripts/frame-scenes/build.py [ids...]   env: HF_REFS (default /home/claude/reports/hf-refs/worlds), DA2 (model path)."""
import json, os, sys
import cv2, numpy as np
import onnxruntime as ort
import pytesseract

REFS = os.environ.get("HF_REFS", "/home/claude/reports/hf-refs/worlds")
DA2 = os.environ.get("DA2", "/tmp/da2/model.onnx")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "public", "worlds", "frames")
boxes = json.load(open(os.path.join(HERE, "boxes.json")))
sess = None

def pad169(img, aspect=1.6):
    h, w = img.shape[:2]
    if w / h < aspect:
        add = int(round(h * aspect - w)); l = add // 2; r = add - l
        img = cv2.copyMakeBorder(img, 0, 0, l, r, cv2.BORDER_REFLECT)
        # the reflected margins are soft: blur them so they read as dim far scenery
        b = cv2.GaussianBlur(img, (0, 0), 9)
        m = np.zeros(img.shape[:2], np.float32); m[:, :l] = 1; m[:, w + l:] = 1
        m = cv2.GaussianBlur(m, (0, 0), 14)[..., None]
        img = (img * (1 - m * 0.8) + b * m * 0.8).astype(np.uint8)
        return img, (l, r, 0, 0)
    if w / h > aspect:
        add = int(round(w / aspect - h)); t = add // 2; bt = add - t
        return cv2.copyMakeBorder(img, t, bt, 0, 0, cv2.BORDER_REFLECT), (0, 0, t, bt)
    return img, (0, 0, 0, 0)

def text_mask(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    m = np.zeros(g.shape, np.uint8)
    for sc in (1, 2):
        big = cv2.resize(g, None, fx=sc, fy=sc, interpolation=cv2.INTER_CUBIC)
        d = pytesseract.image_to_data(big, config="--psm 11", output_type=pytesseract.Output.DICT)
        for i, t in enumerate(d["text"]):
            t = t.strip()
            if len(t) >= 3 and sum(c.isalnum() for c in t) >= 3 and float(d["conf"][i]) > 55:
                x, y, w, h = [int(d[k][i] / sc) for k in ("left", "top", "width", "height")]
                cv2.rectangle(m, (x - 5, y - 5), (x + w + 5, y + h + 5), 255, -1)
    return m

def depth(img):
    global sess
    if sess is None: sess = ort.InferenceSession(DA2, providers=["CPUExecutionProvider"])
    h, w = img.shape[:2]; tw = 686; th = int(round(tw * h / w / 14)) * 14
    x = cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2RGB), (tw, th), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    d = sess.run(None, {"pixel_values": x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0]
    lo, hi = np.percentile(d, 2), np.percentile(d, 98)
    d = np.clip((d - lo) / max(1e-6, hi - lo), 0, 1)
    d = cv2.GaussianBlur(d, (0, 0), 2.2)
    return cv2.resize(d, (512, int(round(512 * h / w))), interpolation=cv2.INTER_AREA)

META = os.path.join(OUT, "index.json")
def save_meta(fid, m):
    d = json.load(open(META)) if os.path.exists(META) else {}
    d[fid] = m; json.dump(d, open(META, "w"), indent=1, sort_keys=True)

def run(fid):
    clean = os.path.join(REFS, f"{fid}-clean.png")
    src = cv2.imread(clean if os.path.exists(clean) else os.path.join(REFS, f"{fid}.png"))
    cfg = boxes.get(fid, {})
    meta = {"crop": [0, 0, 1344, 752], "pad": [0, 0, 0, 0], "clean": True}
    if not os.path.exists(clean):
        x0, y0, x1, y1 = cfg["crop"]; src = src[y0:y1, x0:x1].copy()
        m = text_mask(src)
        for (a, b, c, d) in cfg.get("mask", []):
            a, b, c, d = a - x0, b - y0, c - x0, d - y0
            cv2.rectangle(m, (max(0, a), max(0, b)), (min(src.shape[1], c), min(src.shape[0], d)), 255, -1)
        src = cv2.inpaint(src, m, 6, cv2.INPAINT_TELEA)
        src, pad = pad169(src)
        meta = {"crop": [x0, y0, x1, y1], "pad": list(pad), "clean": False}
    h, w = src.shape[:2]
    img = cv2.resize(src, (2048, int(round(2048 * h / w))), interpolation=cv2.INTER_LANCZOS4)
    os.makedirs(OUT, exist_ok=True)
    cv2.imwrite(os.path.join(OUT, f"{fid}.webp"), img, [cv2.IMWRITE_WEBP_QUALITY, 84])
    cv2.imwrite(os.path.join(OUT, f"{fid}-depth.webp"), (depth(src) * 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 100])
    save_meta(fid, meta)
    print(fid, img.shape, os.path.getsize(os.path.join(OUT, f"{fid}.webp")) // 1024, "KB")

for fid in (sys.argv[1:] or list(boxes)):
    run(fid)
