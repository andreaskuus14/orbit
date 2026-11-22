import { test } from "node:test";
import assert from "node:assert/strict";
import { blenderArgs, blenderError, cleanScene, pickBlender, pruneJobs, renderFileName, renderSite, type RenderJob } from "../src/lib/arch-render-pure.ts";
import { blenderScript } from "../src/lib/arch-blender-pure.ts";
import { starterScene } from "../src/lib/arch-pure.ts";

test("cleanScene keeps a real house and drops anything that isn't a known part with finite numbers", () => {
  const s = starterScene();
  assert.equal(cleanScene(s)!.parts.length, s.parts.length);
  const bad = { parts: [
    ...s.parts.slice(0, 2),
    { ...s.parts[0], id: "k", kind: "x'); import os; os.system('calc') #" },      // unknown kind: dropped
    { ...s.parts[0], id: "n", x: "1); import os #" },                               // number as text: dropped
    { ...s.parts[0], id: "i", w: Infinity }, { ...s.parts[0], id: "f", face: "up" }, // not finite / unknown face
    { ...s.parts[0], id: "huge", x: 1e9 }, null, 7,
  ] };
  assert.deepEqual(cleanScene(bad)!.parts.map((p) => p.id), s.parts.slice(0, 2).map((p) => p.id));
  assert.equal(cleanScene({ parts: [] }), null);
  assert.equal(cleanScene(null), null);
  assert.equal(cleanScene({ parts: "no" }), null);
});

test("a name can't escape into the Python: it is a JSON string literal in the script", () => {
  const s = starterScene();
  const evil = cleanScene({ ...s, parts: [...s.parts.slice(0, 3), { ...s.parts[2], id: "e", name: `"); import os; os.system("calc") #` }] })!;
  const py = blenderScript(evil, { site: { lat: 59.4, lon: 24.7 }, date: new Date("2026-06-21T12:00:00Z"), quality: "preview" });
  assert.ok(py.includes(JSON.stringify(`"); import os; os.system("calc") #`)));
  assert.doesNotMatch(py, /^\s*import os/m);
});

test("pickBlender: BLENDER_PATH wins, then the newest installed version, then PATH", () => {
  const inst = ["C:\\Program Files\\Blender Foundation\\Blender 3.6\\blender.exe", "C:\\Program Files\\Blender Foundation\\Blender 4.10\\blender.exe", "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe"];
  assert.equal(pickBlender(" D:\\b\\blender.exe ", inst), "D:\\b\\blender.exe");
  assert.equal(pickBlender(undefined, inst), inst[1]);
  assert.equal(pickBlender("", []), "blender");
  assert.deepEqual(blenderArgs("s.py", "o.png"), ["-b", "--factory-startup", "-P", "s.py", "--", "o.png"]);
});

test("site from the browser: numbers in range or the defaults", () => {
  const now = new Date("2026-11-22T10:00:00Z");
  assert.deepEqual(renderSite({ lat: 58.38, lon: 26.72, at: "2026-06-21T15:00:00.000Z" }, now), { lat: 58.38, lon: 26.72, date: new Date("2026-06-21T15:00:00.000Z") });
  assert.deepEqual(renderSite({ lat: 200, lon: "x", at: "nope" }, now), { lat: 59.437, lon: 24.7536, date: now });
});

test("plain-words errors and housekeeping", () => {
  assert.match(blenderError("ENOENT", ""), /blender\.org/);
  assert.match(blenderError("ETIMEDOUT", ""), /Preview/);
  assert.match(blenderError(1, "CUDA error: out of memory"), /ran out of memory/);
  assert.match(blenderError(1, "whatever"), /ORBIT's log/);
  assert.equal(renderFileName("detail", "2026-11-22T10:05:07.123Z"), "arch-render-detail-2026-11-22-10-05-07.png");
  const j = (id: string, at: string, extra: Partial<RenderJob> = {}): RenderJob => ({ id, quality: "preview", stage: "done", startedAt: at, at, ...extra });
  const now = Date.parse("2026-11-22T12:00:00Z");
  assert.deepEqual(pruneJobs([j("old", "2026-11-22T01:00:00Z"), j("new", "2026-11-22T11:00:00Z"), j("run", "2026-11-21T00:00:00Z", { stage: "render" })], now).map((x) => x.id), ["new", "run"]);
});
