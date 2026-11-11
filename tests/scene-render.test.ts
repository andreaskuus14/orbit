import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildFilm } from "../src/lib/clips/scene-render.ts";
import { editScene, totalFrames, type Manifest } from "../src/lib/clips/scene-manifest-pure.ts";
import { hex } from "../src/lib/clips/stickman-pure.ts";

const ff = process.env.ORBIT_FFMPEG || "ffmpeg", fp = process.env.ORBIT_FFPROBE || "ffprobe";
const hasFf = spawnSync(ff, ["-version"]).status === 0 && spawnSync(fp, ["-version"]).status === 0;
const fx = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));

/** RGB of pixel (2,2) of frame n. */
function pixel(file: string, n: number): number[] {
  const r = spawnSync(ff, ["-loglevel", "error", "-i", file, "-vf", `select=eq(n\\,${n}),crop=1:1:2:2`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return [...r.stdout];
}

// Real ffmpeg at quarter size (270x480): ~10 s. Skipped without ffmpeg, like the other render tests.
test("real ffmpeg: scene 2 edit re-renders only scene 2 and the join; cuts land on exact frames; renders are reproducible", { skip: !hasFf && "no ffmpeg", timeout: 180_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "w03-")), cache = path.join(dir, "cache");
  try {
    const a: Manifest = fx("film-bridge-gaps.json"), e = fx("film-bridge-gaps-s2-edit.json"), b = editScene(a, e.scene, e.patch);
    const o = { ffmpeg: ff, cache, scale: 0.25 };
    const one = await buildFilm(a, "vertical", { ...o, out: path.join(dir, "before") });
    assert.deepEqual(one.scenes.map((s) => s.reused), [false, false, false]);
    const two = await buildFilm(b, "vertical", { ...o, out: path.join(dir, "after") });
    assert.deepEqual(two.scenes.map((s) => s.reused), [true, false, true]);
    assert.equal(two.final.reused, false);
    assert.equal(two.scenes[0].outputHash, one.scenes[0].outputHash);
    assert.equal(two.scenes[2].outputHash, one.scenes[2].outputHash);
    assert.notEqual(two.scenes[1].outputHash, one.scenes[1].outputHash);
    assert.notEqual(two.final.outputHash, one.final.outputHash);
    // Same manifest again: everything from cache.
    const three = await buildFilm(b, "vertical", { ...o, out: path.join(dir, "again") });
    assert.ok(three.scenes.every((s) => s.reused) && three.final.reused);
    // Reproducible: a cold cache makes byte-identical scenes.
    const cold = await buildFilm(a, "vertical", { ...o, cache: path.join(dir, "cold"), out: path.join(dir, "cold-out") });
    assert.deepEqual(cold.scenes.map((s) => s.outputHash), one.scenes.map((s) => s.outputHash));
    // Exact frame count, and each cut changes the background on its own frame (not one early or late).
    const frames = spawnSync(fp, ["-v", "error", "-count_frames", "-select_streams", "v", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", one.final.file]).stdout.toString().trim();
    assert.equal(Number(frames), totalFrames(a));
    const near = (p: number[], c: number[]) => p.every((x, i) => Math.abs(x - c[i]) <= 6);
    for (const [cut, prev, next] of [[180, a.scenes[0].bg, a.scenes[1].bg], [375, a.scenes[1].bg, a.scenes[2].bg]] as const) {
      assert.ok(near(pixel(one.final.file, cut - 1), hex(prev)), `frame ${cut - 1} is still the earlier scene`);
      assert.ok(near(pixel(one.final.file, cut), hex(next)), `frame ${cut} is the next scene`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
