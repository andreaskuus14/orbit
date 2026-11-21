"""ORBIT photo scan: 3-10 photos of a room, facade or object -> a point cloud ARCH can open and measure.

Model: Depth Anything 3 BASE (ByteDance Seed; code and these weights Apache-2.0, 0.12 B parameters, ~0.5 GB). One feed-forward
pass gives depth, confidence and the camera of every photo; the photos' pixels are lifted into one shared 3D space and written
as a 3DGS-layout binary PLY (one small round splat per point), which ARCH's existing splat viewer, measure and walk tools read.
Not used on purpose: DA3 LARGE/GIANT and the original VGGT-1B (CC BY-NC, non-commercial), MASt3R/DUSt3R (CC BY-NC-SA).

Scale: the model's units are arbitrary (not metres). ARCH asks for one known length (a door's height) and rescales every
measurement from it (arch-measure-pure calibrate). Up: photos are taken with the phone upright, so the average camera "up"
becomes +y; the viewer's flip button fixes the rare case where that guess is wrong.

The numpy parts (points_from_views, upright, splat_ply) have no model or torch dependency: tests/photo_scan_test.py runs them.
"""
from __future__ import annotations

import struct
import sys
import types
from pathlib import Path

import numpy as np

MODEL_DIR_NAME = "da3-base"
MIN_VIEWS, MAX_VIEWS = 3, 10
PROCESS_RES = 504  # DA3's default working size (long side); ~1 GB of GPU memory for 10 photos
MAX_POINTS = 300_000  # ARCH keeps at most this many splats (splat-pure DEFAULT_MAX_SPLATS)
CONF_PERCENTILE = 40.0  # drop the least sure 40 % of pixels (DA3's own GLB export default)
SH_C0 = 0.28209479


def _stub_unused_imports() -> None:
    """depth_anything_3.api imports its export/benchmark helpers at load time. ORBIT never calls them, so instead of installing
    moviepy, evo (GPL), pycolmap, matplotlib and plyfile (GPL) it gives those names empty modules that fail loudly if used."""
    def stub(name: str):
        m = types.ModuleType(name)
        m.__path__ = []  # a package, so "from x.y import z" works

        def get(attr: str):
            if attr.startswith("__"):
                raise AttributeError(attr)

            def unused(*_a, **_k):
                raise ImportError(f"{name}.{attr} is not installed (ORBIT photo scan doesn't use it)")
            return unused
        m.__getattr__ = get  # type: ignore[attr-defined]
        return m
    for name in ("moviepy", "moviepy.editor", "evo", "evo.core", "evo.core.trajectory", "pycolmap", "matplotlib", "matplotlib.cm",
                 "matplotlib.pyplot", "plyfile"):
        if name not in sys.modules:
            try:
                __import__(name)  # really installed: use it
            except Exception:
                sys.modules[name] = stub(name)


def installed(models: Path, has) -> bool:
    return has("depth_anything_3") and has("torchvision") and (models / MODEL_DIR_NAME / "model.safetensors").is_file()


def load_model(models: Path, dev: str):
    _stub_unused_imports()
    from depth_anything_3.api import DepthAnything3
    m = DepthAnything3.from_pretrained(str(models / MODEL_DIR_NAME)).eval()
    return m.to(dev)


def predict(model, images: list, dev: str):
    """images: PIL RGB pictures. Returns DA3's Prediction (depth, conf, extrinsics w2c 3x4, intrinsics, processed_images)."""
    import torch
    with torch.inference_mode():
        if dev.startswith("cuda"):
            with torch.autocast("cuda", dtype=torch.float16):
                return model.inference(images, process_res=PROCESS_RES)
        return model.inference(images, process_res=PROCESS_RES)


# ---------------- pure numpy from here ----------------

def cam_to_world(ext: np.ndarray) -> np.ndarray:
    """OpenCV world-to-camera [R|t] (3x4 or 4x4) -> camera-to-world 4x4."""
    m = np.eye(4)
    m[:3, :4] = ext[:3, :4]
    return np.linalg.inv(m)


def points_from_views(depth, conf, ext, K, rgb, conf_percentile=CONF_PERCENTILE, max_points=MAX_POINTS, seed=0):
    """Lift every confident pixel of every view into world space. depth/conf: N,H,W; ext: N,3,4 (w2c); K: N,3,3; rgb: N,H,W,3 uint8.
    Returns xyz (M,3) float32, colour (M,3) 0..1, footprint (M,) world size of one pixel at that depth, and the kept share."""
    n, h, w = depth.shape
    u, v = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    ok = np.isfinite(depth) & (depth > 0)
    if conf is not None:
        c = np.where(ok, conf, np.nan)
        if np.isfinite(c).any():
            ok &= np.nan_to_num(c, nan=-np.inf) >= np.nanpercentile(c, conf_percentile)
    xyz, col, foot = [], [], []
    for i in range(n):
        m = ok[i]
        z = depth[i][m]
        fx, fy, cx, cy = K[i][0, 0], K[i][1, 1], K[i][0, 2], K[i][1, 2]
        cam = np.stack([(u[m] - cx) / fx * z, (v[m] - cy) / fy * z, z, np.ones_like(z)], 0)
        xyz.append((cam_to_world(ext[i]) @ cam)[:3].T)
        col.append(rgb[i][m].astype(np.float32) / 255.0)
        foot.append(z / ((fx + fy) / 2))
    xyz, col, foot = np.concatenate(xyz), np.concatenate(col), np.concatenate(foot)
    kept = len(xyz) / float(n * h * w)
    if len(xyz) > max_points:
        pick = np.sort(np.random.default_rng(seed).choice(len(xyz), max_points, replace=False))
        xyz, col, foot = xyz[pick], col[pick], foot[pick]
    return xyz.astype(np.float32), col, foot.astype(np.float32), kept


def up_vector(ext: np.ndarray) -> np.ndarray:
    """World "up" from the cameras. A phone held upright keeps its right edge (camera +x) level, while it may tilt down or up, so
    up is the direction at right angles to every camera's right edge. When all photos face the same way (one facade) that
    leaves one direction unknown; then up is the average camera up with the shared right edge taken out."""
    c2w = [cam_to_world(e)[:3, :3] for e in ext]
    rights, ups = np.stack([m[:, 0] for m in c2w]), np.stack([-m[:, 1] for m in c2w])
    mean_up = ups.mean(0)
    _, s, vt = np.linalg.svd(rights)
    if len(s) >= 2 and s[1] > 0.2 * s[0]:
        up = vt[-1]
    else:
        r = rights.mean(0)
        r /= np.linalg.norm(r) or 1.0
        up = mean_up - np.dot(mean_up, r) * r
    if np.dot(up, mean_up) < 0:
        up = -up
    return up / (np.linalg.norm(up) or 1.0)


def upright(ext: np.ndarray) -> np.ndarray:
    """Rotation (3x3) that turns the photos' "up" (up_vector) into +y."""
    up = up_vector(ext)
    y = np.array([0.0, 1.0, 0.0])
    axis, c = np.cross(up, y), float(np.dot(up, y))
    s = np.linalg.norm(axis)
    if s < 1e-8:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    k = axis / s
    kx = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + s * kx + (1 - c) * (kx @ kx)  # Rodrigues


def splat_ply(xyz: np.ndarray, rgb01: np.ndarray, footprint: np.ndarray, comment: str = "") -> bytes:
    """Binary little-endian PLY in the 3D Gaussian splatting layout splat-pure readSplats needs: round splats, about two pixels
    wide where they were seen, nearly opaque, colour as the zeroth spherical harmonic."""
    n = len(xyz)
    props = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
    head = "ply\nformat binary_little_endian 1.0\n"
    if comment:
        head += "".join(f"comment {line}\n" for line in comment.replace("\r", "").split("\n") if line)
    head += f"element vertex {n}\n" + "".join(f"property float {p}\n" for p in props) + "end_header\n"
    data = np.zeros((n, len(props)), dtype="<f4")
    data[:, 0:3] = xyz
    data[:, 3:6] = (np.clip(rgb01, 0, 1) - 0.5) / SH_C0
    data[:, 6] = 4.0  # sigmoid(4) = 0.98
    data[:, 7:10] = np.log(np.maximum(footprint, 1e-6) * 1.2)[:, None]
    data[:, 10] = 1.0  # identity rotation (w, x, y, z)
    return head.encode("ascii") + data.tobytes()


def build(pred, rgb: np.ndarray | None = None) -> tuple[bytes, dict]:
    """DA3 Prediction -> (ply bytes, report). Upright, the first camera at the origin's height, nothing else moved."""
    depth, conf, ext, K = pred.depth, pred.conf, pred.extrinsics, pred.intrinsics
    img = rgb if rgb is not None else pred.processed_images
    xyz, col, foot, kept = points_from_views(depth, conf, ext, K, img)
    R = upright(ext)
    xyz = (xyz @ R.T).astype(np.float32)
    centres = np.stack([(R @ cam_to_world(e)[:3, 3]) for e in ext])
    lo, hi = np.percentile(xyz, 2, 0), np.percentile(xyz, 98, 0)
    report = {
        "views": int(depth.shape[0]), "points": int(len(xyz)), "kept": round(float(kept), 3),
        "size": [round(float(v), 3) for v in (hi - lo)], "cameras": [[round(float(v), 4) for v in c] for c in centres],
        "model": "Depth Anything 3 BASE (Apache-2.0)", "units": "model units (calibrate on one known length)",
    }
    return splat_ply(xyz, col, foot, "ORBIT photo scan, Depth Anything 3 BASE (Apache-2.0); units: not metres until calibrated"), report


def check_views(n: int) -> str:
    if n < MIN_VIEWS:
        return f"Add more photos: at least {MIN_VIEWS} (you sent {n})."
    if n > MAX_VIEWS:
        return f"Too many photos: at most {MAX_VIEWS} (you sent {n})."
    return ""


def check_shapes(sizes: list[tuple[int, int]]) -> str:
    """All photos must have the same shape (DA3 squeezes them to one size, which would bend the geometry)."""
    ratios = [w / h for w, h in sizes if h]
    if ratios and max(ratios) / min(ratios) > 1.02:
        return "Take all photos the same way: all upright or all sideways, same camera."
    return ""


def ply_header_ok(b: bytes) -> bool:
    return b.startswith(b"ply\nformat binary_little_endian 1.0\n") and b"end_header\n" in b[:4096]


if __name__ == "__main__":  # quick manual check: python photo_scan.py <models dir> a.jpg b.jpg c.jpg -> scan.ply
    from PIL import Image
    import time
    models, files = Path(sys.argv[1]), sys.argv[2:]
    t = time.time()
    dev = "cuda:0" if __import__("torch").cuda.is_available() else "cpu"
    pred = predict(load_model(models, dev), [Image.open(f).convert("RGB") for f in files], dev)
    ply, rep = build(pred)
    Path("scan.ply").write_bytes(ply)
    print(rep, f"{time.time() - t:.1f} s on {dev}", struct.calcsize("<f") * 14 * rep["points"], "bytes of points")
