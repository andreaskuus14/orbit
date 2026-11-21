import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  burstConfig, checkUpload, cliError, decideBurst, hoursLeft, isOrbitSlug, kaggleContent, kernelMetadata, parsePush, parseQuotaCsv, parseStatus,
  remoteVideoSettings, runTimeoutSec, segmentsFor, usedThisWeek, videoNeed, videoScript, WAN, type BurstEnv, type BurstNeed,
} from "../src/lib/kaggle-pure.ts";
import { approvalGate, contentHash, EFFECTS, isConsequential } from "../src/lib/approval-pure.ts";

const cfg = burstConfig({});
const env = (o: Partial<BurstEnv> = {}): BurstEnv => ({ cfg, setupOk: true, setupHint: "", remoteBusy: false, hoursLeft: 30, ...o });
const need = (o: Partial<BurstNeed> = {}): BurstNeed => ({ kind: "video", vramGb: 7, localMin: 4, remoteMin: 60, remoteReady: true, ...o });

test("config: defaults, ORBIT_KAGGLE=0 off, clamps", () => {
  assert.deepEqual(cfg, { on: true, localVramGb: 8, maxLocalMin: 30, reserveH: 2, weeklyH: 30 });
  assert.equal(burstConfig({ ORBIT_KAGGLE: "0" }).on, false);
  assert.equal(burstConfig({ ORBIT_KAGGLE_LOCAL_MAX_MIN: "-5", ORBIT_LOCAL_VRAM_GB: "abc" }).maxLocalMin, 1);
  assert.equal(burstConfig({ ORBIT_LOCAL_VRAM_GB: "abc" }).localVramGb, 8);
});

test("decide: local first when it fits and is quick", () => {
  assert.equal(decideBurst(need(), env()).run, "local");
  assert.equal(decideBurst(need({ localMin: 30 }), env()).run, "local");
  // even with Kaggle off, unset or busy, a fitting job stays local with no note
  assert.deepEqual(decideBurst(need(), env({ cfg: { ...cfg, on: false }, setupOk: false, remoteBusy: true, hoursLeft: 0 })), { run: "local", note: "" });
});

test("decide: offer when VRAM need > local, too slow, or impossible locally", () => {
  const big = decideBurst(need({ vramGb: 14, localMin: null }), env());
  assert.equal(big.run, "offer");
  assert.match((big as { why: string }).why, /14 GB.*8 GB/);
  const slow = decideBurst(need({ localMin: 45, remoteMin: 90 }), env());
  assert.deepEqual([slow.run, (slow as { hours: number }).hours], ["offer", 1.5]);
  assert.equal(decideBurst(need({ localMin: null }), env()).run, "offer");
});

test("decide: off, not set up, busy, low hours, too big for Kaggle → local with note when possible, else refuse", () => {
  const off = decideBurst(need({ localMin: null }), env({ cfg: { ...cfg, on: false } }));
  assert.equal(off.run, "refuse"); assert.match((off as { why: string }).why, /ORBIT_KAGGLE=0/);
  const slowOff = decideBurst(need({ localMin: 45 }), env({ cfg: { ...cfg, on: false } }));
  assert.equal(slowOff.run, "local"); assert.match((slowOff as { note: string }).note, /45 min.*ORBIT_KAGGLE=0/);
  assert.match((decideBurst(need({ localMin: null }), env({ setupOk: false, setupHint: "run setup" })) as { why: string }).why, /isn't set up yet \(run setup\)/);
  assert.match((decideBurst(need({ localMin: null }), env({ remoteBusy: true })) as { why: string }).why, /one at a time/);
  assert.match((decideBurst(need({ localMin: null, remoteMin: 120 }), env({ hoursLeft: 3.5 })) as { why: string }).why, /only 3.5 h .*left.*2 h spare/);
  assert.equal(decideBurst(need({ localMin: null, remoteMin: 120 }), env({ hoursLeft: 4 })).run, "offer"); // 4 - 2 = 2 spare: ok
  assert.match((decideBurst(need({ vramGb: 40, localMin: null }), env()) as { why: string }).why, /16 GB/);
  assert.match((decideBurst(need({ localMin: null, remoteMin: 13 * 60 }), env({ hoursLeft: 30 })) as { why: string }).why, /12 h/);
  assert.match((decideBurst(need({ kind: "3d", localMin: null, remoteReady: false }), env()) as { why: string }).why, /no Kaggle recipe for 3d/);
  assert.match((decideBurst(need({ localMin: null, remoteBlock: "VAULT files never go" }), env()) as { why: string }).why, /VAULT files never go/);
});

test("video need: >5 s can't run locally; estimates; segments", () => {
  assert.equal(videoNeed({ seconds: 5, quality: "fast" }).localMin, 4);
  assert.equal(videoNeed({ seconds: 12, quality: "fast" }).localMin, null);
  assert.deepEqual([segmentsFor(2), segmentsFor(5), segmentsFor(6), segmentsFor(30), segmentsFor(99)], [1, 1, 2, 6, 6]);
  assert.equal(videoNeed({ seconds: 20, quality: "best" }).remoteMin, 20 + 4 * 60);
  assert.deepEqual(remoteVideoSettings({ prompt: "x", negative: "", seconds: 10, quality: "best", aspect: "9:16", seed: 1 }),
    { width: 704, height: 1280, steps: 50, guidance: 5, frames: 121, fps: 24, segments: 2 });
});

test("weekly hours: Kaggle's numbers minus ORBIT runs since; else rolling 7 days", () => {
  const q = parseQuotaCsv("resource,used,remaining,total,refreshAt\nGPU,3.50h,26.50h,30.00h,2026-11-22T00:00:00+00:00\nTPU,0.00h,20.00h,20.00h,x\n")!;
  assert.deepEqual(q, { usedH: 3.5, totalH: 30, refreshAt: "2026-11-22T00:00:00+00:00", source: "kaggle" });
  assert.equal(parseQuotaCsv("No quota information available"), null);
  const now = 10 * 86_400_000;
  const rows = [{ at: now - 8 * 86_400_000, hours: 5, job: "a" }, { at: now - 86_400_000, hours: 2, job: "b" }, { at: now - 1000, hours: 1, job: "c" }];
  assert.equal(usedThisWeek(rows, now), 3);
  assert.equal(hoursLeft(null, rows, now, 30), 27);
  assert.equal(hoursLeft(q, rows, now, 30, now - 5000), 25.5); // only "c" ran after the quota was read
  assert.equal(hoursLeft(null, [{ at: now, hours: 50, job: "x" }], now, 30), 0);
});

test("uploads: only the job's own files; never VAULT/LIFE/journal or private-looking names; size + count caps", () => {
  const d = "C:\\orbit\\kaggle\\jobs\\v1\\push", priv = ["C:\\orbit\\vault", "C:\\orbit\\life.json"];
  const f = (name: string, p = `${d}\\${name}`, bytes = 10) => ({ name, path: p, bytes });
  assert.equal(checkUpload([], d, priv), "");
  assert.equal(checkUpload([f("frame.png")], d, priv), "");
  assert.match(checkUpload([f("x.png", "C:\\orbit\\vault\\x.png")], d, priv), /only the job's own/);
  assert.match(checkUpload([f("x.png", `${d}\\..\\..\\x.png`)], d, priv), /only the job's own/);
  assert.match(checkUpload([f("x.png", `${d}\\sub\\x.png`)], d, priv), /only the job's own/);
  for (const n of ["journal.txt", "LIFE.json", "my-vault.zip", "kaggle.json", "access_token", ".env.local", "memories.md", "secret.png"]) assert.match(checkUpload([f(n)], d, priv), /private/, n);
  assert.match(checkUpload([f("a.png", undefined, 5 * 1024 * 1024)], d, priv), /4 MB/);
  assert.match(checkUpload([1, 2, 3, 4, 5].map((i) => f(`${i}.png`)), d, priv), /at most 4/);
  // a staging folder inside VAULT would still be refused
  assert.match(checkUpload([f("a.png", "C:\\orbit\\vault\\job\\a.png")], "C:\\orbit\\vault\\job", priv), /VAULT/);
});

test("script: private GPU metadata, pinned model + libraries, prompt can't break out, valid Python", () => {
  const m = kernelMetadata("andy", "video-abc");
  assert.deepEqual([m.id, m.is_private, m.enable_gpu, m.enable_internet, m.machine_shape, m.dataset_sources.length], ["andy/orbit-burst-video-abc", "true", "true", "true", "NvidiaTeslaT4", 0]);
  assert.ok(isOrbitSlug(m.id));
  assert.ok(!isOrbitSlug("andy/my-competition-notebook"));
  const evil = 'a cat")\nimport os; os.system("rm -rf /")  # \\" \u2028 ünïcode """';
  const s = videoScript({ prompt: evil, negative: "blurry", seconds: 12, quality: "fast", aspect: "16:9", seed: 42 });
  assert.ok(s.includes(WAN.revision) && s.includes("diffusers==0.43.0") && s.includes("transformers==5.23.0"));
  assert.ok(!s.split("\n").some((l) => l.startsWith("import os")), "prompt stayed inside the string");
  assert.ok(s.includes("a cat"), "prompt is readable in the script he approves");
  let py = "";
  try { py = execFileSync("python3", ["--version"], { encoding: "utf8" }); } catch { /* no python here */ }
  if (py) {
    const dir = path.join(tmpdir(), `orbit-kaggle-py-${process.pid}`); mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "job.py"), s);
    execFileSync("python3", ["-I", "-c", "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())", path.join(dir, "job.py")]);
    // the settings line decodes back to exactly the prompt
    const line = s.split("\n").find((l) => l.startsWith("P = json.loads("))!;
    const out = execFileSync("python3", ["-I", "-c", `import json\n${line}\nprint(json.dumps(P["prompt"]))`], { encoding: "utf8" });
    assert.equal(JSON.parse(out), evil);
    assert.equal(JSON.parse(execFileSync("python3", ["-I", "-c", `import json\n${line}\nprint(P["segments"])`], { encoding: "utf8" })), 3);
  }
});

test("CLI output parsing and plain errors", () => {
  assert.deepEqual(parseStatus('andy/orbit-burst-x has status "KernelWorkerStatus.RUNNING"'), { state: "running", message: "" });
  assert.equal(parseStatus('x has status "complete"').state, "complete");
  assert.equal(parseStatus('x has status "KernelWorkerStatus.QUEUED"').state, "queued");
  assert.equal(parseStatus('x has status "KernelWorkerStatus.CANCEL_ACKNOWLEDGED"').state, "cancelled");
  assert.deepEqual(parseStatus('x has status "KernelWorkerStatus.ERROR"\nFailure message: "CUDA out of memory"'), { state: "error", message: "CUDA out of memory" });
  assert.equal(parseStatus("garbage").state, "unknown");
  assert.deepEqual(parsePush("Kernel version 1 successfully pushed.  Please check progress at https://www.kaggle.com/code/a/b"), { ok: true });
  assert.deepEqual(parsePush("Kernel push error: Notebook not found"), { error: "Notebook not found" });
  assert.match(cliError("401 Client Error: Unauthorized"), /token/);
  assert.match(cliError("spawn kaggle ENOENT"), /setup\.ps1/);
  assert.match(cliError("Your GPU quota has been exceeded"), /used up/);
  assert.match(cliError("phone verification required"), /phone/);
  assert.equal(runTimeoutSec(0.1), 4320);
  assert.equal(runTimeoutSec(2), 5 * 3600);
  assert.equal(runTimeoutSec(9), 12 * 3600);
});

test("approval: kaggle.upload is an outward send; the click must carry the exact script's hash", async () => {
  assert.equal(EFFECTS["kaggle.upload"], "outward-send");
  assert.ok(isConsequential("kaggle.upload"));
  const o = { id: "video-1", script: "print(1)", files: [] };
  assert.match(await approvalGate("kaggle.upload", undefined, kaggleContent(o)), /Needs your approval/);
  const seen = await contentHash(kaggleContent(o));
  assert.equal(await approvalGate("kaggle.upload", seen, kaggleContent(o)), "");
  assert.match(await approvalGate("kaggle.upload", seen, kaggleContent({ ...o, script: "print(2)" })), /changed/);
});

// ---------- IO with a fake Kaggle CLI ----------

const root = await mkdtemp(path.join(tmpdir(), "orbit-kaggle-"));
process.env.ORBIT_DATA_DIR = path.join(root, "data");
process.env.KAGGLE_CONFIG_DIR = path.join(root, "kcfg");
process.env.ORBIT_KAGGLE_POLL_MS = "50";
const log = path.join(root, "cli.log"), plan = path.join(root, "plan.json");
const fake = path.join(root, "kaggle-fake.mjs");
// The fake logs every call and answers from plan.json: { status: [..., ...] (one per call, last repeats), push, quota, outputOk }
writeFileSync(fake, `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
const a = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + "\\n");
const p = JSON.parse(readFileSync(${JSON.stringify(plan)}, "utf8"));
const save = () => writeFileSync(${JSON.stringify(plan)}, JSON.stringify(p));
if (a[0] === "quota") { if (p.quota) { console.log(p.quota); } else { console.error("401 Unauthorized"); process.exit(1); } }
else if (a[1] === "push") { console.log(p.push ?? "Kernel version 1 successfully pushed.  Please check progress at https://www.kaggle.com/code/x/y"); }
else if (a[1] === "status") { const s = p.status.length > 1 ? p.status.shift() : p.status[0]; save(); console.log(a[2] + ' has status "KernelWorkerStatus.' + s + '"'); if (s === "ERROR") console.log('Failure message: "CUDA out of memory"'); }
else if (a[1] === "output") { const dir = a[a.indexOf("-p") + 1]; mkdirSync(dir, { recursive: true }); if (p.outputOk !== false) writeFileSync(path.join(dir, "orbit-out.mp4"), Buffer.alloc(4096, 1)); writeFileSync(path.join(dir, "orbit_job.log"), "log"); }
else if (a[1] === "delete") { console.log("Kernel deleted"); }
`);
chmodSync(fake, 0o755);
process.env.ORBIT_KAGGLE_CLI = fake;
const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]) : []);
const setPlan = (p: object) => { writeFileSync(plan, JSON.stringify(p)); writeFileSync(log, ""); };
const k = await import("../src/lib/kaggle.ts");
const saved: { name: string; bytes: number }[] = [];
k.setImporterForTests(async (r, b) => { saved.push({ name: r.name, bytes: b.length }); return r.name; });
const offerIn = (script = "print('hi')") => ({ kind: "video" as const, title: "Video, 12 s: a cat", script, hours: 1.5, why: "Too long", result: { type: "video" as const, name: "a-cat.mp4" } });

test("IO: no token → not set up, no offer decision, CLI never called for quota", async () => {
  setPlan({ status: ["RUNNING"] });
  assert.equal(k.kaggleSetup().ok, false);
  const d = await k.decide(videoNeed({ seconds: 12, quality: "fast" }));
  assert.equal(d.run, "refuse");
  assert.match((d as { why: string }).why, /isn't set up/);
  assert.equal(calls().length, 0);
});

test("IO: offer → approve → push → poll → output → saved; usage counted; script deleted on Kaggle; key never on any command line", async () => {
  mkdirSync(process.env.KAGGLE_CONFIG_DIR!, { recursive: true });
  writeFileSync(path.join(process.env.KAGGLE_CONFIG_DIR!, "kaggle.json"), JSON.stringify({ username: "andy", key: "SECRET-KEY-123" }));
  setPlan({ status: ["QUEUED", "RUNNING", "COMPLETE"], quota: "resource,used,remaining,total,refreshAt\nGPU,1.00h,29.00h,30.00h,2026-11-22T00:00:00+00:00" });
  assert.equal(k.kaggleSetup().user, "andy");
  const d = await k.decide(videoNeed({ seconds: 12, quality: "fast" }));
  assert.equal(d.run, "offer");
  const o = await k.addOffer(offerIn());
  const v = await k.kaggleView();
  assert.equal(v.offers.length, 1);
  assert.equal(v.hoursLeft, 29);
  const job = await k.startOffer(o.id);
  assert.equal(job.kernel, `andy/orbit-burst-${o.id}`);
  await k.waitPollerForTests();
  const end = (await k.kaggleView()).job!;
  assert.equal(end.status, "done", end.error);
  assert.deepEqual(end.saved, ["a-cat.mp4"]);
  assert.deepEqual(saved, [{ name: "a-cat.mp4", bytes: 4096 }]);
  const c = calls();
  const push = c.find((x) => x[1] === "push")!;
  assert.deepEqual([push[0], push[2] !== undefined, push.includes("-t")], ["kernels", true, true]);
  assert.ok(c.some((x) => x[1] === "output" && x.includes("--file-pattern")));
  assert.deepEqual(c.at(-1), ["kernels", "delete", job.kernel, "-y"]);
  assert.ok(!JSON.stringify(c).includes("SECRET-KEY"), "the key never goes on a command line");
  // the pushed folder held exactly the script + private metadata, and is cleaned up afterwards
  assert.equal(existsSync(path.join(process.env.ORBIT_DATA_DIR!, "kaggle", "jobs", o.id)), false);
  const st = JSON.parse(readFileSync(path.join(process.env.ORBIT_DATA_DIR!, "kaggle", "state.json"), "utf8")) as { usage: { job: string }[]; offers: unknown[] };
  assert.equal(st.usage.at(-1)!.job, o.id);
  assert.equal(st.offers.length, 0);
});

test("IO: Kaggle error → failed with its message; a second job waits for none (one at a time)", async () => {
  setPlan({ status: ["ERROR"], quota: "GPU,1.00h,29.00h,30.00h," });
  const o = await k.addOffer(offerIn());
  await k.startOffer(o.id);
  await k.waitPollerForTests();
  const j = (await k.kaggleView()).job!;
  assert.equal(j.status, "failed");
  assert.match(j.error!, /CUDA out of memory/);
  // one at a time: while one runs, another can't start
  setPlan({ status: ["RUNNING"], quota: "GPU,1.00h,29.00h,30.00h," });
  const a = await k.addOffer(offerIn()), b = await k.addOffer({ ...offerIn(), title: "second" });
  await k.startOffer(a.id);
  await assert.rejects(k.startOffer(b.id), /one at a time/);
  assert.equal((await k.decide(videoNeed({ seconds: 12, quality: "fast" }))).run, "refuse");
  // Cancel deletes ORBIT's own script and ends the job
  assert.equal(await k.cancelKaggle("Cancelled by you"), true);
  await k.waitPollerForTests();
  assert.equal((await k.kaggleView()).job!.status, "cancelled");
  assert.ok(calls().some((x) => x[1] === "delete" && isOrbitSlug(x[2])));
});

test("IO: Stop-all cancels a running job; refuses to start while on", async () => {
  const { setStopAll } = await import("../src/lib/stop-all.ts");
  setPlan({ status: ["RUNNING"], quota: "GPU,1.00h,29.00h,30.00h," });
  const o = await k.addOffer(offerIn());
  await k.startOffer(o.id);
  await setStopAll(true);
  await k.waitPollerForTests();
  const j = (await k.kaggleView()).job!;
  assert.equal(j.status, "cancelled");
  assert.match(j.error!, /Stop-all/);
  const o2 = await k.addOffer(offerIn());
  await assert.rejects(k.startOffer(o2.id), /Stop-all/);
  await setStopAll(false);
});

test("IO: low hours refuse at the click too; push errors are plain; ORBIT_KAGGLE=0 refuses", async () => {
  setPlan({ status: ["RUNNING"], quota: "GPU,29.00h,1.00h,30.00h," });
  k.resetKaggleForTests(); // forget the cached quota
  const o = await k.addOffer(offerIn());
  await assert.rejects(k.startOffer(o.id), /Only 1\.0 h/);
  setPlan({ status: ["RUNNING"], quota: "GPU,1.00h,29.00h,30.00h,", push: "Kernel push error: Phone verification required" });
  k.resetKaggleForTests();
  const o2 = await k.addOffer(offerIn());
  await assert.rejects(k.startOffer(o2.id), /Phone verification/);
  assert.equal((await k.kaggleView()).job!.status, "failed");
  process.env.ORBIT_KAGGLE = "0";
  const o3 = await k.addOffer(offerIn());
  await assert.rejects(k.startOffer(o3.id), /ORBIT_KAGGLE=0/);
  assert.equal((await k.decide(videoNeed({ seconds: 12, quality: "fast" }))).run, "refuse");
  delete process.env.ORBIT_KAGGLE;
});

test("IO: finished but no video → failed, nothing saved", async () => {
  setPlan({ status: ["COMPLETE"], quota: "GPU,1.00h,29.00h,30.00h,", outputOk: false });
  k.resetKaggleForTests();
  saved.length = 0;
  const o = await k.addOffer(offerIn());
  await k.startOffer(o.id);
  await k.waitPollerForTests();
  const j = (await k.kaggleView()).job!;
  assert.equal(j.status, "failed");
  assert.match(j.error!, /no video/);
  assert.equal(saved.length, 0);
});
