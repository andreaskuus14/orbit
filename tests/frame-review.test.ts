import { test } from "node:test";
import assert from "node:assert/strict";
import { frameIssues, parseStats, reviewArgs, sampleTimes, verdict } from "../src/lib/clips/frame-review-pure.ts";

const log = (y: number, lo: number, hi: number, sat: number, size = "1080x1920") =>
  `Stream #0:0: Video: h264, yuv420p, ${size}, 24 fps\n[Parsed_metadata_2] lavfi.signalstats.YMIN=${lo}\nlavfi.signalstats.YAVG=${y}\nlavfi.signalstats.YMAX=${hi}\nlavfi.signalstats.SATAVG=${sat}\n`;
const good = parseStats(log(110, 18, 235, 40))!;

test("sampling: images once; clips 3-5 frames away from the cuts", () => {
  assert.deepEqual(sampleTimes(5, false), [0]);
  assert.deepEqual(sampleTimes(10, true), [1.2, 5, 8.8]);
  assert.equal(sampleTimes(10, true, 9).length, 5);
  assert.deepEqual(sampleTimes(0, true), [0], "unknown length: the first frame");
  assert.deepEqual(reviewArgs("a.png", 0).slice(0, 3), ["-hide_banner", "-i", "a.png"]);
});

test("stats come from ffmpeg's log; no numbers means not judged", () => {
  assert.deepEqual(good, { yavg: 110, ymin: 18, ymax: 235, satavg: 40, w: 1080, h: 1920 });
  assert.equal(parseStats("ffmpeg version 7\n"), null);
  assert.deepEqual(frameIssues(good), []);
});

test("what a viewer notices: blank, dark, blown out, flat, soft", () => {
  assert.deepEqual(frameIssues(parseStats(log(16, 16, 17, 0))!), ["blank"]);
  assert.deepEqual(frameIssues(parseStats(log(128, 126, 130, 0))!), ["blank"], "a grey stand-in box shows nothing");
  assert.ok(frameIssues(parseStats(log(30, 16, 120, 20))!).includes("too dark"));
  assert.ok(frameIssues(parseStats(log(225, 140, 255, 10))!).includes("blown out"));
  assert.ok(frameIssues(parseStats(log(120, 100, 150, 20))!).includes("flat (no contrast)"));
  assert.match(frameIssues(parseStats(log(110, 18, 235, 40, "640x960"))!).join(), /soft \(640x960/);
});

test("verdict: an all-blank scene stops the render; majority issues warn; same frame everywhere may be frozen", () => {
  const blank = parseStats(log(16, 16, 17, 0))!, dark = parseStats(log(30, 16, 120, 20))!;
  const v = verdict([{ scene: 0, frames: [good, good, { ...good, yavg: 140 }] }, { scene: 1, frames: [blank, blank, blank] }, { scene: 2, frames: [dark, dark, good] }, { scene: 3, frames: [good, good, good] }, { scene: 4, frames: [null, null] }]);
  assert.deepEqual(v.stop, ["Scene 2 is blank"]);
  assert.ok(v.warn.includes("Scene 3: too dark in 2 of 3 key frames"));
  assert.ok(v.warn.some((w) => /Scene 4: .*frozen/.test(w)));
  assert.ok(!v.warn.some((w) => /Scene 1:|Scene 5:/.test(w)), "fine and unmeasured scenes stay quiet");
});

test("reviewFrames with real ffmpeg: a black scene stops before assembly, a normal one passes", async (t) => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  let ff = ""; try { ff = (await import("ffmpeg-static")).default as unknown as string; } catch { /* not installed */ }
  if (!ff) return t.skip("no ffmpeg here");
  const { reviewFrames } = await import("../src/lib/clips/story-render.ts");
  const dir = mkdtempSync(path.join(tmpdir(), "frames-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const make = (name: string, src: string) => { execFileSync(ff, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `${src}${src.includes("=") ? ":" : "="}s=1080x1920:d=3`, "-pix_fmt", "yuv420p", path.join(dir, name)]); return path.join(dir, name); };
  const good = make("good.mp4", "testsrc2"), black = make("black.mp4", "color=c=black");
  const { spawnSync } = await import("node:child_process");
  const run = async (args: string[], cwd: string) => spawnSync(ff, args, { cwd, encoding: "utf8" }).stderr; // runFfmpeg also returns the log
  const deps = { ffmpeg: (a: string[], cwd: string) => run(a, cwd), duration: async () => 3, save: async () => {} };
  const job = (files: string[]) => ({ story: { scenes: files.map(() => ({ sec: 3 })) }, items: files.map((file, scene) => ({ kind: "video", scene, file })), warnings: [] as string[] }) as never;
  const ok = job([good]); await reviewFrames(ok, dir, deps, new AbortController().signal);
  assert.deepEqual((ok as { warnings: string[] }).warnings, []);
  await assert.rejects(reviewFrames(job([good, black]), dir, deps, new AbortController().signal), /Scene 2 is blank/);
});
