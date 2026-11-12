// Trial 3: render one script with ORBIT's STUDIO (AI Story path) and time it; time an OpenMontage run you give as a command.
// Usage: node studio-vs-openmontage.mjs --script script.txt [--assets ./assets] [--om-cmd "<your OpenMontage command>"] [--length 45]
// STUDIO side: write -> quote -> you type "yes" at the credit quote (the same owner approval as the Approve button) -> poll until done.
// Nothing is spent without that typed yes. The AI Story path makes its own images/voice: --assets is only inventoried and checked
// against OpenMontage (STUDIO's story path does not take an asset folder; see README).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import path from "node:path";
import { ORBIT, orbitHeaders, writeResult, cell } from "./lib/util.mjs";

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const scriptFile = arg("--script"), assets = arg("--assets"), omCmd = arg("--om-cmd"), length = Number(arg("--length") ?? 45);
if (!scriptFile) { console.error("--script <file> required"); process.exit(1); }
const script = readFileSync(scriptFile, "utf8").trim();
const secs = (t0) => ((performance.now() - t0) / 1000).toFixed(1);
const api = async (m, p, b) => {
  const r = await fetch(ORBIT + p, { method: m, headers: orbitHeaders({ "content-type": "application/json" }), body: b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${p} HTTP ${r.status} ${j.error ?? ""}`); return j;
};

let studio = { note: "not run" };
try {
  const t0 = performance.now();
  let { story } = await api("POST", "/api/studio/clips/story", { action: "write", idea: script.slice(0, 1000), style: "", length, voice: "kokoro:af_heart", motion: "stills" });
  ({ story } = await api("POST", "/api/studio/clips/story", { action: "quote", id: story.id }));
  const q = story.quote, tQuote = secs(t0);
  console.log(`STUDIO quote: ${q.total} credits (balance ${q.balance ?? "unknown"}). Story id ${story.id}.`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const yes = (await rl.question(`Type "yes" to approve spending ${q.total} credits (anything else skips the render): `)).trim() === "yes"; rl.close();
  if (!yes) studio = { note: `quoted ${q.total} credits, not approved`, tQuote };
  else {
    const t1 = performance.now();
    await api("POST", "/api/studio/clips/story", { action: "approve", id: story.id, credits: q.total, seen: q.fingerprint });
    for (;;) {
      await new Promise((r) => setTimeout(r, 10_000));
      const j = (await api("GET", "/api/studio/clips/story")).stories.find((s) => s.id === story.id);
      if (j && (j.status === "done" || j.status === "failed")) { studio = { status: j.status, tWrite: tQuote, tRender: secs(t1), credits: q.total, clip: j.clipJob, err: j.error?.message }; break; }
      if (performance.now() - t1 > 40 * 60_000) { studio = { status: "timeout", tRender: secs(t1) }; break; }
    }
  }
} catch (e) { studio = { note: "failed: " + e.message }; }

let om = { note: "no --om-cmd given: run OpenMontage by hand (README) and time it" };
if (omCmd) { const t = performance.now(); const r = spawnSync(omCmd, { shell: true, stdio: "inherit" }); om = { exit: r.status, t: secs(t) }; }

const files = assets && existsSync(assets) ? readdirSync(assets).map((f) => `${f} (${(statSync(path.join(assets, f)).size / 1e6).toFixed(1)} MB)`) : [];
const md = `# Trial 3: OpenMontage vs STUDIO\n\nRun ${new Date().toISOString()}. Script: \`${path.basename(scriptFile)}\` (${script.split(/\s+/).length} words), target ${length} s.\n\n` +
`| | STUDIO (AI Story) | OpenMontage |\n|---|---|---|\n| Render time | ${studio.tRender ? studio.tRender + " s" : "-"} (script to quote: ${studio.tWrite ?? studio.tQuote ?? "-"} s) | ${om.t ? om.t + " s (exit " + om.exit + ")" : "-"} |\n` +
`| Status / notes | ${cell(studio.status ?? studio.note)}${studio.err ? " " + cell(studio.err) : ""} | ${cell(om.note ?? "")} |\n| Credits / keys | ${studio.credits ?? "-"} credits | no-key audio path first: ____ |\n\n` +
`Assets (${assets ?? "none"}): ${files.length ? files.join(", ") : "none listed"}\n\n## Checklist (watch both outputs, fill in)\n\n| Check | STUDIO | OpenMontage |\n|---|---|---|\n` +
`| Pacing: cuts land on sentence ends, no scene over 6 s without motion | | |\n| Captions: present, in sync within ~0.2 s, readable on a phone, no clipped words | | |\n| Shot replacement: swap one shot for my own asset in under 2 min without re-rendering everything | | |\n` +
`| Audio: voice quality, music ducking, no clipping | | |\n| License: voice/music/model licenses allow YouTube monetisation (write the license names) | | |\n| Re-run: same script gives a comparable result; can I resume after a failure | | |\n| Winner for my use, and why (one line) | | |\n`;
writeResult("openmontage-vs-studio", md);
