import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkPhotos, parseReport, photoScanNote, pruneJobs, scanFileName, scanProgress, type ScanJob } from "../src/lib/photo-scan-pure.ts";
import { scanVaultName, studioItems } from "../src/lib/arch-studio-pure.ts";
import { readSplats, scanBounds } from "../src/lib/splat-pure.ts";

const ph = (n: number, name = "IMG.jpg", bytes = 1000) => Array.from({ length: n }, (_, i) => ({ name: `${i}-${name}`, bytes }));

test("photo set: 3-10 JPG/PNG/WebP photos under 15 MB, plain refusals", () => {
  assert.equal(checkPhotos(ph(3)), "");
  assert.equal(checkPhotos(ph(10, "a.webp")), "");
  assert.match(checkPhotos(ph(2)), /at least 3/);
  assert.match(checkPhotos(ph(11)), /best 10/);
  assert.match(checkPhotos(ph(4, "a.heic")), /JPG, PNG or WebP/);
  assert.match(checkPhotos(ph(4, "a.png", 16 * 1024 * 1024)), /too big/);
  assert.match(checkPhotos(ph(4, "a.png", 0)), /empty/);
});

test("VAULT file name is a safe slug with the date", () => {
  assert.equal(scanFileName("Elutuba / köök", "2026-11-21T22:00:00Z"), "photo-scan-elutuba-kook-2026-11-21.ply");
  assert.equal(scanFileName("../..", "2026-11-21"), "photo-scan-scan-2026-11-21.ply");
});

test("report header: checked, odd input is null", () => {
  const r = parseReport(JSON.stringify({ views: 8, points: 300000, kept: 0.6, size: [1.6, 0.77, 1.16], cameras: [], device: "GPU" }));
  assert.deepEqual(r, { views: 8, points: 300000, kept: 0.6, size: [1.6, 0.77, 1.16], device: "GPU" });
  assert.equal(parseReport(JSON.stringify({ views: 8, points: 1, kept: 1, size: [1, 2] })), null);
  assert.equal(parseReport("not json"), null);
  assert.equal(parseReport(null), null);
  assert.equal(parseReport(JSON.stringify({ views: 3, points: 9, kept: 0.5, size: [1, 1, 1], device: "<b>" }))?.device, "CPU");
});

test("MEMORY note is a scan ARCH's library lists and reopens", () => {
  const n = photoScanNote({ title: "living room", vault: "photo-scan-living-room-2026-11-21.ply", photos: 8, report: { views: 8, points: 300000, kept: 0.6, size: [1.6, 0.77, 1.16], device: "CPU" } });
  assert.equal(scanVaultName(n.content), "photo-scan-living-room-2026-11-21.ply");
  assert.match(n.content, /not metres until calibrated/);
  const [it] = studioItems([{ id: "m1", title: n.title, content: n.content, tags: n.tags, created_at: "2026-11-21T22:00:00Z" }]);
  assert.equal(it.kind, "scan");
  assert.equal(it.vault, "photo-scan-living-room-2026-11-21.ply");
});

const job = (p: Partial<ScanJob>): ScanJob => ({ id: "j1", title: "living room", photos: 8, stage: "read", startedAt: "2026-11-21T22:00:00Z", at: "2026-11-21T22:00:00Z", ...p });
const NOW = Date.parse("2026-11-21T22:00:30Z");

test("card: working steps, GPU wait line, then 'Set the size' waits for him with one Open", () => {
  const a = scanProgress(job({ stage: "build" }), "en", NOW);
  assert.equal(a.phase, "working");
  assert.deepEqual(a.steps.map((s) => s.state), ["done", "done", "now", "next", "next"]);
  assert.equal(a.leftMin, 1);
  const w = scanProgress(job({ stage: "gpu", wait: "Waiting for the GPU (picture running)" }), "en", NOW);
  assert.equal(w.now, "Waiting for the GPU (picture running)");
  const d = scanProgress(job({ stage: "done", saved: "photo-scan-x.ply", report: { views: 8, points: 1234, kept: 0.5, size: [1, 1, 1], device: "GPU" } }), "en", NOW);
  assert.equal(d.phase, "needs");
  assert.equal(d.steps.at(-1)?.label, "Set the size");
  assert.equal(d.steps.at(-1)?.state, "now");
  assert.equal(d.action?.kind, "open");
  assert.equal(d.action?.open, "#o=arch&scan=photo-scan-x.ply");
  assert.match(d.result?.text ?? "", /door/);
  const et = scanProgress(job({ stage: "done", saved: "x.ply", report: { views: 3, points: 9, kept: 1, size: [1, 1, 1], device: "CPU" } }), "et", NOW);
  assert.equal(et.action?.label, "Ava ja määra suurus");
});

test("card: a failure shows the plain reason and a retry", () => {
  const f = scanProgress(job({ stage: "build", error: "Photo scan isn't installed yet." }), "en", NOW);
  assert.equal(f.phase, "failed");
  assert.equal(f.result?.text, "Photo scan isn't installed yet.");
  assert.equal(f.action?.kind, "retry");
});

test("old finished jobs drop off; running ones stay", () => {
  const old = job({ id: "a", stage: "done", at: "2026-11-19T00:00:00Z" }), run = job({ id: "b", stage: "build", at: "2026-11-19T00:00:00Z" });
  assert.deepEqual(pruneJobs([old, run], NOW).map((j) => j.id), ["b"]);
});

test("photo_scan.py's PLY (fixture written by splat_ply) opens in ARCH's splat reader", () => {
  const s = readSplats(new Uint8Array(readFileSync(new URL("./fixtures/photo-scan-small.ply", import.meta.url))));
  assert.equal(s.format, "ply");
  assert.equal(s.count, 24);
  assert.equal(s.skipped, 0);
  assert.deepEqual([...s.positions.slice(3, 6)], [0, 2, 0]);
  assert.ok(Math.abs(s.scales[0] - 0.012) < 1e-6); // footprint 0.01 × 1.2
  assert.ok(s.opacities[0] > 0.98);
  const b = scanBounds(s.positions);
  assert.ok(b.hi[1] > b.lo[1]);
});
