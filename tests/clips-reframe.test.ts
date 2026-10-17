import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_KEYS, TRACK_H, TRACK_W, analyse, capKeys, bestWindow, frameEnergy, pathAt, pathExpr, remapPath, smoothPath, trackAction, type Key } from "../src/lib/clips/reframe.ts";
import { layoutFilter, renderArgs, renderFilter, trackArgs, validOptions, validVersion } from "../src/lib/clips/pure.ts";

// The ffmpeg expression as JS (only what pathExpr emits), to check it against pathAt.
const evalExpr = (e: string, t: number) => Function("t", `const lt=(a,b)=>+(a<b),gte=(a,b)=>+(a>=b);return ${e};`)(t) as number;

test("smoothPath: jitter inside the dead zone keeps the camera still", () => {
  const keys = smoothPath(Array.from({ length: 40 }, (_, i) => ({ t: i / 4, p: 0.5 + (i % 2 ? 0.08 : -0.08) })));
  assert.deepEqual(keys.map((k) => k.p), [0.5, 0.5]);
});

test("smoothPath: a far target pans at the speed limit, then holds on target", () => {
  const keys = smoothPath(Array.from({ length: 40 }, (_, i) => ({ t: i / 4, p: i < 4 ? 0.5 : 0.9 })), { dead: 0.12, speed: 0.4 });
  for (let t = 0; t < 9.75; t += 0.25) assert.ok(Math.abs(pathAt(keys, t + 0.25) - pathAt(keys, t)) <= 0.1 + 1e-9, `jump at ${t}`);
  assert.ok(Math.abs(pathAt(keys, 9.75) - 0.9) < 1e-9);
  assert.ok(keys.length <= 4, `ramp + hold collapse to few keys: ${JSON.stringify(keys)}`);
});

test("smoothPath: a scene cut jumps straight to the new subject, between the two samples", () => {
  const keys = smoothPath([{ t: 0, p: 0.1 }, { t: 0.25, p: 0.1 }, { t: 0.5, p: 0.9, cut: true }, { t: 0.75, p: 0.9 }]);
  assert.equal(pathAt(keys, 0.37), 0.1);
  assert.equal(pathAt(keys, 0.375), 0.9);
  // no target (flat shot) after a cut → centre
  assert.equal(pathAt(smoothPath([{ t: 0, p: 0.1 }, { t: 0.25, p: null, cut: true }]), 1), 0.5);
});

test("remapPath follows jump cuts and the teaser onto the edited timeline", () => {
  const keys: Key[] = [{ t: 0, p: 0 }, { t: 10, p: 1 }]; // p = t/10
  const out = remapPath(keys, [{ start: 1, end: 3 }, { start: 6, end: 8 }], { start: 7, end: 8 });
  for (const [u, want] of [[0, 0.7], [0.5, 0.75], [1, 0.1], [2, 0.2], [3, 0.6], [4.9, 0.79]]) assert.ok(Math.abs(pathAt(out, u) - want) < 1e-6, `t=${u}: ${pathAt(out, u)} want ${want}`);
  assert.deepEqual(remapPath([], [{ start: 0, end: 5 }]), []);
});

test("pathExpr matches pathAt, including jumps, before the first and after the last key", () => {
  const keys: Key[] = [{ t: 0.5, p: 0.2 }, { t: 2, p: 0.2 }, { t: 3, p: 0.6 }, { t: 3, p: 0 }, { t: 4, p: 0 }, { t: 5.5, p: 1 }];
  const e = pathExpr(keys);
  for (let t = 0; t < 7; t += 0.05) assert.ok(Math.abs(evalExpr(e, t) - pathAt(keys, t)) < 1e-3, `t=${t}`);
  assert.equal(pathExpr([]), "0.5");
  assert.ok(!/\+-|--/.test(e), e);
  // 3 min of keys every 0.25 s stays a flat sum (no nesting) of a sane length
  const many = Array.from({ length: 720 }, (_, i) => ({ t: i / 4, p: (i % 7) / 7 }));
  assert.ok(pathExpr(many).length < 30_000 && !pathExpr(many).includes("if("));
  assert.ok(capKeys(many).length <= MAX_KEYS);
  // a long smooth wander is simplified (not just decimated) and stays within ~0.05 of the original
  const wave = Array.from({ length: 2000 }, (_, i) => ({ t: i / 10, p: 0.5 + 0.4 * Math.sin(i / 40) }));
  const capped = capKeys(wave);
  assert.ok(capped.length <= MAX_KEYS);
  for (const k of wave) assert.ok(Math.abs(pathAt(capped, k.t) - k.p) < 0.06, `t=${k.t}`);
});

const frame = (box: number | null, bright = 0) => { // grey frame with a 20 px wide white bar at column `box`
  const f = new Uint8Array(TRACK_W * TRACK_H).fill(bright);
  if (box !== null) for (let y = 30; y < 60; y++) for (let x = box; x < box + 20; x++) f[y * TRACK_W + x] = 255;
  return f;
};

test("frameEnergy/bestWindow: motion wins, flat frames give no target, a full-frame change is a cut", () => {
  const { energy, cuts } = frameEnergy([frame(20), frame(24), frame(24, 200)], TRACK_W, TRACK_H);
  assert.deepEqual(cuts, [false, false, true]);
  const p = bestWindow(energy[1], 51)!;
  assert.ok(p <= 20 / 109 + 1e-9, `bar at the left → window at the left: ${p}`);
  assert.equal(bestWindow(new Float64Array(TRACK_W), 51), null);
  assert.equal(bestWindow(new Float64Array(TRACK_W).fill(3), 51), null);
});

test("analyse: a bar crossing the frame is followed smoothly; 9:16 sources need no tracking", () => {
  const n = 40, buf = new Uint8Array(n * TRACK_W * TRACK_H);
  for (let i = 0; i < n; i++) buf.set(frame(10 + i * 3), i * TRACK_W * TRACK_H);
  const keys = analyse(buf, 16 / 9);
  assert.ok(pathAt(keys, 0) < 0.25 && pathAt(keys, 9.75) > 0.6, JSON.stringify(keys));
  for (let t = 0; t < 9.5; t += 0.25) assert.ok(pathAt(keys, t + 0.25) >= pathAt(keys, t) - 1e-9, "never pans back");
  assert.deepEqual(analyse(buf, 9 / 16), []);
});

test("layouts, options and the expression land in the filter graph", () => {
  assert.match(layoutFilter("i", "o", "follow", "right", "0.3"), /crop='min\(iw,ih\*9\/16\)':'min\(ih,iw\*16\/9\)':'\(iw-ow\)\*\(0\.3\)'/);
  const corner = layoutFilter("i", "o", "split", "br", "0.5", 0.25);
  assert.match(corner, /crop='min\(iw\*0\.25,ih\*16\/9\)':'min\(iw\*0\.25\*9\/16,ih\)':'iw-ow':'ih-oh'/);
  assert.match(layoutFilter("i", "o", "split", "tl", "0.5", 5), /iw\*0\.6,/); // clamped
  assert.match(layoutFilter("i", "o", "split", "tl", "0.5", NaN), /iw\*0\.3,/);
  assert.match(corner, /\[c1\]\[g1\]vstack\[o\]/); // cam on top
  assert.match(layoutFilter("i", "o", "split", "left"), /\[g1\]\[c1\]vstack/); // side cams unchanged
  assert.match(renderFilter({ duration: 5, layout: "follow", follow: [{ t: 0, p: 0.1 }, { t: 4, p: 0.9 }] }), /gte\(t,0\)\*lt\(t,4\)/);
  assert.ok(trackArgs("a.mp4", 3, 10).includes("-protocol_whitelist"));
  assert.equal(typeof validOptions({ layout: "follow", camSide: "tr", camSize: 0.4 }), "object");
  assert.match(validOptions({ camSize: 0.9 }) as string, /camSize/);
  assert.match(validVersion({ camSide: "middle" }) as string, /camSide/);
  assert.deepEqual((validVersion({ layout: "split", camSide: "tl", camSize: 0.22 }) as { edit: object }).edit, { layout: "split", camSide: "tl", camSize: 0.22 });
});

const ff = process.env.ORBIT_FFMPEG || "ffmpeg";
const hasFf = spawnSync(ff, ["-version"]).status === 0;

test("real ffmpeg: tracking a moving box, then follow + corner-split renders are 1080x1920", { skip: !hasFf && "no ffmpeg" }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "orbit-reframe-"));
  try {
    const run = (args: string[]) => spawnSync(ff, ["-hide_banner", "-nostdin", "-y", ...args], { cwd: dir, encoding: "utf8" });
    assert.equal(run(["-f", "lavfi", "-i", "color=c=gray:s=640x360:r=25:d=6[bg];color=c=white:s=60x60:r=25[fg];[bg][fg]overlay=x='20+t*90':y=150:shortest=1",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "src.mp4"]).status, 0);
    const keys = await trackAction(ff, trackArgs(path.join(dir, "src.mp4"), 0.5, 5), new AbortController().signal);
    assert.ok(pathAt(keys, 0.5) < 0.35 && pathAt(keys, 4.5) > 0.6, JSON.stringify(keys));
    for (const [layout, camSide, out] of [["follow", "right", "f.mp4"], ["split", "tr", "s.mp4"]] as const) {
      const r = run(renderArgs({ input: "src.mp4", start: 0.5, duration: 5, segs: [{ start: 0, end: 2 }, { start: 3, end: 5 }], layout, camSide, follow: keys, out }).slice(3));
      assert.equal(r.status, 0, r.stderr.slice(-800));
      assert.match(run(["-i", out, "-f", "null", "-"]).stderr, /Video: h264.*1080x1920/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
