"""photo_scan.py's numpy parts (no model, no torch): python -m unittest discover -s tools/local-ai/tests"""
import struct
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import photo_scan as ps  # noqa: E402


def look(c, target):
    """OpenCV camera-to-world rotation (x right, y down, z forward) for a level camera at c looking at target."""
    f = np.asarray(target, float) - c
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 1.0, 0])
    r /= np.linalg.norm(r)
    return np.stack([r, np.cross(f, r), f], 1)


def w2c(c, R):
    m = np.eye(4)
    m[:3, :3], m[:3, 3] = R, c
    return np.linalg.inv(m)[:3]


class PhotoScan(unittest.TestCase):
    def test_points_land_on_the_true_surface(self):
        # Two cameras looking at the wall z = 3 (y up in this world, cameras y down).
        h, w, f = 12, 16, 10.0
        K = np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1]])
        exts, depths = [], []
        for c in ([0.0, 1.5, 0.0], [0.5, 1.5, 0.2]):
            c = np.array(c)
            R = look(c, c + [0, 0, 1])
            exts.append(w2c(c, R))
            depths.append(np.full((h, w), 3.0 - c[2]))
        rgb = np.full((2, h, w, 3), 128, np.uint8)
        xyz, col, foot, kept = ps.points_from_views(np.stack(depths), None, np.stack(exts), np.stack([K, K]), rgb)
        self.assertEqual(len(xyz), 2 * h * w)
        self.assertAlmostEqual(kept, 1.0)
        np.testing.assert_allclose(xyz[:, 2], 3.0, atol=1e-5)
        self.assertTrue(np.allclose(col, 128 / 255))
        self.assertAlmostEqual(float(foot[0]), 0.3, places=5)  # depth 3 / focal 10

    def test_confidence_drops_the_least_sure_pixels(self):
        d = np.ones((1, 4, 5))
        conf = np.arange(20, dtype=float).reshape(1, 4, 5)
        K = np.array([[[5, 0, 2.5], [0, 5, 2], [0, 0, 1]]])
        ext = np.array([np.eye(4)[:3]])
        xyz, *_ , kept = ps.points_from_views(d, conf, ext, K, np.zeros((1, 4, 5, 3), np.uint8), conf_percentile=50)
        self.assertEqual(len(xyz), 10)
        self.assertAlmostEqual(kept, 0.5)

    def test_max_points_is_a_stable_even_sample(self):
        d = np.ones((1, 20, 20))
        K = np.array([[[10, 0, 10], [0, 10, 10], [0, 0, 1]]])
        a = ps.points_from_views(d, None, np.array([np.eye(4)[:3]]), K, np.zeros((1, 20, 20, 3), np.uint8), max_points=50)
        b = ps.points_from_views(d, None, np.array([np.eye(4)[:3]]), K, np.zeros((1, 20, 20, 3), np.uint8), max_points=50)
        self.assertEqual(len(a[0]), 50)
        np.testing.assert_array_equal(a[0], b[0])

    def test_up_is_found_even_when_every_photo_looks_down(self):
        # Cameras around a room, all pitched 20 degrees down, in a world whose up is tilted (the model's frame is arbitrary).
        tilt = ps.upright(np.array([w2c(np.zeros(3), look(np.zeros(3), [0, -0.4, 1]))]))  # any fixed rotation
        exts = []
        for a in np.linspace(0, 2 * np.pi, 6, endpoint=False):
            c = np.array([np.cos(a), 1.5, np.sin(a)])
            R = look(c, [0, 1.5 - np.tan(np.radians(20)) * 1.0, 0])
            exts.append(w2c(tilt @ c, tilt @ R))
        R = ps.upright(np.array(exts))
        np.testing.assert_allclose(R @ (tilt @ [0, 1.0, 0]), [0, 1, 0], atol=1e-6)

    def test_one_direction_facade_keeps_the_level_edge(self):
        # All photos face the same way: level photos give the exact up; tilted ones stay at right angles to the level edge
        # (their shared tilt can't be told apart from a sloping world, a known limit written in the README).
        level = [w2c(np.array([x, 1.6, 0]), look(np.array([x, 1.6, 0]), [x, 1.6, 5])) for x in (-1, 0, 1)]
        np.testing.assert_allclose(ps.up_vector(np.array(level)), [0, 1, 0], atol=1e-6)
        tilted = [w2c(np.array([x, 1.6, 0]), look(np.array([x, 1.6, 0]), [x, 1.0, 5])) for x in (-1, 0, 1)]
        self.assertAlmostEqual(float(np.dot(ps.up_vector(np.array(tilted)), [1, 0, 0])), 0.0, places=6)

    def test_ply_is_the_3dgs_layout_arch_reads(self):
        xyz = np.array([[0, 0, 0], [1, 2, 3]], np.float32)
        b = ps.splat_ply(xyz, np.array([[1, 0, 0], [0.5, 0.5, 0.5]]), np.array([0.01, 0.02]), "two\nlines")
        self.assertTrue(ps.ply_header_ok(b))
        head, body = b.split(b"end_header\n", 1)
        self.assertIn(b"comment two\ncomment lines\n", head)
        self.assertIn(b"element vertex 2\n", head)
        self.assertEqual(len(body), 2 * 14 * 4)
        row = struct.unpack("<14f", body[56:])
        self.assertEqual(row[:3], (1.0, 2.0, 3.0))
        self.assertAlmostEqual(row[3] * ps.SH_C0 + 0.5, 0.5, places=5)
        self.assertAlmostEqual(np.exp(row[7]), 0.024, places=5)
        self.assertEqual(row[10:], (1.0, 0.0, 0.0, 0.0))

    def test_plain_refusals(self):
        self.assertIn("at least 3", ps.check_views(2))
        self.assertIn("at most 10", ps.check_views(11))
        self.assertEqual(ps.check_views(5), "")
        self.assertEqual(ps.check_shapes([(4032, 3024), (1600, 1200)]), "")
        self.assertIn("same way", ps.check_shapes([(4032, 3024), (3024, 4032)]))


if __name__ == "__main__":
    unittest.main()
