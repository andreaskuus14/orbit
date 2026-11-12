// Trial 2: ORBIT's current voice path (POST /api/voice/transcribe, local Whisper) vs Moonshine on the same clips.
// Usage: node voice-trial.mjs [--model moonshine/base]   (needs ORBIT running + ORBIT_COOKIE; Moonshine runs in .venv)
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { ORBIT, TRIALS, orbitHeaders, errorRates, parseClips, pct, mean, median, cell, writeResult } from "./lib/util.mjs";

const model = process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : "moonshine/base";
const clips = parseClips(readFileSync(path.join(TRIALS, "clips.txt"), "utf8"));
const wav = (c) => path.join(TRIALS, "clips", c.lang, c.id + ".wav");
const have = clips.filter((c) => existsSync(wav(c)));
if (!have.length) { console.error("No clips yet: record clips/en/en-01.wav ... (see clips.txt)."); process.exit(1); }

const py = path.join(TRIALS, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
let ms = {};
if (existsSync(py)) {
  const r = spawnSync(py, [path.join(TRIALS, "moonshine_run.py"), model, ...have.map(wav)], { encoding: "utf8", maxBuffer: 1 << 26 });
  try { ms = JSON.parse(r.stdout); } catch { console.error("Moonshine run failed:", (r.stderr || "").slice(-400)); }
} else console.error("No .venv: run voice-trial.ps1 first (it creates it). Moonshine column will be empty.");

async function orbitStt(c) {
  const t = performance.now();
  try {
    const r = await fetch(`${ORBIT}/api/voice/transcribe?lang=${c.lang}`, { method: "POST", headers: orbitHeaders({ "content-type": "audio/wav" }), body: readFileSync(wav(c)) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { text: j.text ?? "", sec: (performance.now() - t) / 1000 } : { error: `HTTP ${r.status} ${j.error ?? ""}` };
  } catch (e) { return { error: e.message }; }
}
await orbitStt(have[0]); // warm-up: the first call loads the model; leaving it in would punish ORBIT's latency unfairly
const rows = [];
for (const c of have) {
  const o = await orbitStt(c), m = ms[wav(c)] ?? { error: "not run" };
  rows.push({ c, o, m, oe: o.text != null ? errorRates(c.text, o.text) : null, me: m.text != null ? errorRates(c.text, m.text) : null });
}
const sum = (lang, k) => { const r = rows.filter((x) => x.c.lang === lang && x[k + "e"]); return r.length ? `${pct(mean(r.map((x) => x[k + "e"].wer)))} / ${pct(mean(r.map((x) => x[k + "e"].cer)))} / ${median(r.map((x) => x[k].sec)).toFixed(2)} s (n=${r.length})` : "no data"; };
let md = `# Trial 2: Moonshine vs ORBIT voice\n\nRun ${new Date().toISOString()}, Moonshine model \`${model}\`, ORBIT ${ORBIT} (local Whisper path).\n\n`;
md += `| Language | ORBIT WER / CER / median latency | Moonshine WER / CER / median latency |\n|---|---|---|\n`;
for (const l of ["en", "et"]) md += `| ${l} | ${sum(l, "o")} | ${sum(l, "m")} |\n`;
md += `\nLatency is wall time per clip after one warm-up call. ORBIT's includes the HTTP hop and its queue; Moonshine's is in-process after load. ` +
  `Both are CPU unless noted; a fair read needs the same machine state. Numbers/names count as errors when spoken-vs-written forms differ (digits vs words).\n\n`;
md += `## Per clip\n\n| Clip | Reference | ORBIT | WER | Moonshine | WER |\n|---|---|---|---|---|---|\n`;
for (const { c, o, m, oe, me } of rows) md += `| ${c.id} | ${cell(c.text)} | ${cell(o.text ?? o.error)} | ${oe ? pct(oe.wer) : "-"} | ${cell(m.text ?? m.error)} | ${me ? pct(me.wer) : "-"} |\n`;
md += `\n## Interruption handling (fill in by hand; not measurable from clips)\n\n- [ ] Say "ORBIT, stop" while ORBIT is speaking: does speech cut off within ~1 s? (ORBIT today: wake word + client mic in src/components/voice/.)\n- [ ] Does Moonshine's streaming/short-segment mode give a usable partial transcript before you stop talking? (Whisper needs the full ≤30 s clip.)\n- [ ] Barge-in: start talking over the reply; does the transcript still come out clean?\n- Estonian: Moonshine's English models are not trained for Estonian. A high ET error rate means "unsupported", not "needs tuning".\n`;
writeResult("voice-moonshine", md);
