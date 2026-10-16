import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildAss, renderArgs } from "../src/lib/clips/pure.ts";

// Runs the real filter graph through ffmpeg (ORBIT_FFMPEG, else ffmpeg on PATH); skipped when there is none.
const ff = process.env.ORBIT_FFMPEG || "ffmpeg";
const hasFf = spawnSync(ff, ["-version"]).status === 0;

test("a jump-cut, split-layout, zoomed, captioned render (and one with cold open + progress bar) is 1080x1920 yuv420p with A/V in sync", { skip: !hasFf && "no ffmpeg" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "orbit-clip-"));
  try {
    const run = (args: string[]) => spawnSync(ff, ["-hide_banner", "-nostdin", "-y", ...args], { cwd: dir, encoding: "utf8" });
    assert.equal(run(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=8", "-f", "lavfi", "-i", "sine=f=440:sample_rate=44100:d=8", "-ac", "1",
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", "src.mp4"]).status, 0);
    const segs = [{ start: 0, end: 2 }, { start: 3, end: 5.5 }];
    writeFileSync(path.join(dir, "c.ass"), buildAss({ hook: "Hook", words: [{ start: 0.2, end: 0.6, text: "hi", loud: true }, { start: 3, end: 3.4, text: "there" }], duration: 4.5 }));
    const r = run(renderArgs({ input: "src.mp4", start: 1, duration: 6, segs, audio: true, layout: "split", zooms: [1, 3.5], ass: "c.ass", out: "out.mp4" }).slice(3));
    assert.equal(r.status, 0, r.stderr.slice(-800));
    const info = run(["-i", "out.mp4", "-map", "0:v", "-map", "0:a", "-f", "null", "-"]).stderr;
    assert.match(info, /Video: h264.*yuv420p.*1080x1920/);
    assert.match(info, /Audio: aac.*48000 Hz, stereo/);
    const probeOf = (file: string) => (sel: string) => { // last "time=" of decoding one stream ≈ its duration
      const t = [...run(["-i", file, "-map", sel, "-f", "null", "-"]).stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop()!;
      return +t[1] * 3600 + +t[2] * 60 + +t[3];
    };
    const probe = probeOf("out.mp4"), probe2 = probeOf("out2.mp4");
    const v = probe("0:v"), a = probe("0:a");
    assert.ok(Math.abs(v - 4.5) < 0.1 && Math.abs(a - v) < 0.1, `video ${v} s, audio ${a} s, want 4.5`);
    // Cold open (1.5 s teaser from a second input) + progress bar + end fade: 1.5 + 4.5 s.
    const r2 = run(renderArgs({ input: "src.mp4", start: 1, duration: 6, segs, audio: true, layout: "fit", ass: "c.ass", out: "out2.mp4",
      teaser: { start: 4, end: 5.5 }, progressBar: true, fadeOut: true }).slice(3));
    assert.equal(r2.status, 0, r2.stderr.slice(-800));
    const v2 = probe2("0:v"), a2 = probe2("0:a");
    assert.ok(Math.abs(v2 - 6) < 0.1 && Math.abs(a2 - v2) < 0.1, `video ${v2} s, audio ${a2} s, want 6`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
