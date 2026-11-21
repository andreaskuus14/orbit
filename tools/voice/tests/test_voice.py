"""Tests for the desk listener's pure parts. Run: python -m unittest discover -s tools/voice/tests (from the ORBIT folder).
The VAD tests need tools/voice/models/silero_vad.onnx (setup.ps1 puts it there); real-speech checks need ORBIT_VOICE_SAMPLES
(a folder with wake16.wav = "Hey Orbit, ...", other16.wav = speech without it, 16 kHz mono)."""
import json
import os
import re
import sys
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
import orbit_voice as v  # noqa: E402
import pc_actions  # noqa: E402

MODEL = HERE / "models" / "silero_vad.onnx"
F = v.BLOCK


class Pure(unittest.TestCase):
    def test_private_window(self):
        self.assertTrue(v.private_window("chrome.exe", "LIFE (private · ORBIT) - Google Chrome"))
        self.assertTrue(v.private_window("KeePassXC.exe", "db"))
        self.assertTrue(v.private_window("msedge.exe", "Swedbank – Internetipank"))
        self.assertFalse(v.private_window("chrome.exe", "Orbital - Google Chrome"))
        self.assertFalse(v.private_window("Code.exe", "seborrhea.md"))  # "seb" only as a whole word

    def test_private_list_matches_ts(self):
        ts = (HERE.parent.parent / "src" / "lib" / "jarvis-pure.ts").read_text(encoding="utf-8")
        m = re.search(r"export const PRIVATE_WINDOW = (\{[\s\S]*?\n\});", ts)
        j = re.sub(r",\s*([\]}])", r"\1", re.sub(r"(\w+):", r'"\1":', m.group(1)))
        self.assertEqual(json.loads(j), v.PRIVATE_WINDOW)

    def test_segmenter(self):
        s, z = v.Segmenter(), np.zeros(F, np.float32)
        out = [s.push(z, p) for p in [0.0] * 20 + [0.9] * 30 + [0.1] * 40]
        got = [u for u in out if u is not None]
        self.assertEqual(len(got), 1)
        self.assertGreaterEqual(len(got[0]), 30 * F)  # speech + pre-roll + the closing silence
        s2 = v.Segmenter()
        self.assertEqual([u for u in (s2.push(z, p) for p in [0.9] * 5 + [0.1] * 40) if u is not None], [])  # a cough is too short
        s3 = v.Segmenter(max_s=1.0)
        self.assertEqual(len([u for u in (s3.push(z, 0.9) for _ in range(40)) if u is not None]), 1)  # capped

    def test_barge(self):
        b, hit = v.Barge(), -1
        levels = [0.03] * 20 + [0.2] * 20
        for i, l in enumerate(levels):
            if b.step(l, 32, True, True):
                hit = i
                break
        self.assertEqual(hit, 20 + 6)  # 7 frames x 32 ms >= 200 ms
        b2 = v.Barge()
        self.assertFalse(any(b2.step(0.03, 32, True, True) for _ in range(50)))  # its own echo never barges
        b3 = v.Barge()
        self.assertFalse(any(b3.step(l, 32, True, False) for l in levels))  # loud but not a voice (VAD says no)

    def test_wav_roundtrip(self):
        x = np.sin(np.linspace(0, 100, 16000)).astype(np.float32) * 0.5
        y, r = v.read_wav(v.wav_bytes(x))
        self.assertEqual(r, 16000)
        self.assertLess(float(np.max(np.abs(x - y))), 1e-3)


class PcActions(unittest.TestCase):
    def test_folders(self):
        fs = pc_actions.parse_folders("/tmp;C:\\Windows;relative")
        self.assertEqual([str(f) for f in fs], ["/tmp"])
        self.assertTrue(str(pc_actions.inside("/tmp/x.txt", fs)).endswith("x.txt"))
        with self.assertRaises(PermissionError):
            pc_actions.inside("/etc/passwd", fs)
        with self.assertRaises(PermissionError):
            pc_actions.inside("/tmp/../etc/passwd", fs)

    def test_move_and_undo(self):
        import tempfile
        d = Path(tempfile.mkdtemp(dir="/tmp"))
        (d / "a.txt").write_text("hi")
        fs = [d]
        r = pc_actions.act("rename_file", {"from": str(d / "a.txt"), "to": str(d / "b.txt")}, fs)
        self.assertTrue(r["ok"]) ; self.assertTrue((d / "b.txt").exists())
        with self.assertRaises(PermissionError):
            pc_actions.act("move_file", {"from": str(d / "b.txt"), "to": "/etc/b.txt"}, fs)
        self.assertTrue(pc_actions.undo("rename_file", r["undo"], fs)["ok"])
        self.assertTrue((d / "a.txt").exists())

    def test_code_edit_on_branch(self):
        import subprocess, tempfile
        d = Path(tempfile.mkdtemp(dir="/tmp"))
        run = lambda *a: subprocess.run(["git", *a], cwd=d, capture_output=True, text=True)
        run("init", "-q", "-b", "main"); run("config", "user.email", "t@t"); run("config", "user.name", "t")
        (d / "a.lua").write_text("local x = 1\n"); run("add", "."); run("commit", "-qm", "init")
        r = pc_actions.act("code_edit", {"repo": str(d), "file": "a.lua", "find": "x = 1", "replace": "x = 2"}, [d])
        self.assertTrue(r["ok"], r)
        self.assertTrue(run("rev-parse", "--abbrev-ref", "HEAD").stdout.startswith("orbit/voice-edit-"))
        self.assertTrue(pc_actions.undo("code_edit", r["undo"], [d])["ok"])
        self.assertEqual(run("rev-parse", "--abbrev-ref", "HEAD").stdout.strip(), "main")
        self.assertEqual((d / "a.lua").read_text(), "local x = 1\n")  # his branch untouched
        self.assertFalse(pc_actions.act("code_edit", {"repo": str(d), "file": "a.lua", "find": "nope", "replace": ""}, [d])["ok"])


@unittest.skipUnless(MODEL.exists(), "silero_vad.onnx not downloaded")
class VadModel(unittest.TestCase):
    def test_silence_and_noise_send_nothing(self):
        vad = v.Vad(MODEL)
        rng = np.random.default_rng(1)
        self.assertEqual(v.utterances(vad, np.zeros(16000 * 3, np.float32)), [])
        self.assertEqual(v.utterances(vad, (rng.standard_normal(16000 * 3) * 0.01).astype(np.float32)), [])

    @unittest.skipUnless(os.environ.get("ORBIT_VOICE_SAMPLES"), "set ORBIT_VOICE_SAMPLES to a folder of 16 kHz speech wavs")
    def test_real_speech_is_one_utterance(self):
        d = Path(os.environ["ORBIT_VOICE_SAMPLES"])
        for n in ("wake16.wav", "other16.wav"):
            x, _ = v.read_wav((d / n).read_bytes())
            us = v.utterances(v.Vad(MODEL), x)
            self.assertEqual(len(us), 1, n)
            self.assertGreater(len(us[0]) / 16000, 1.0)


if __name__ == "__main__":
    unittest.main()
