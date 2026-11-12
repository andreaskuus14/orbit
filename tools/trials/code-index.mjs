// Trial 4: code-index tools on the ORBIT repo. Usage: node code-index.mjs [--repo <orbit root>] [--tool Graphify]
// 1) verifies repo + license live from GitHub (no install). 2) per tool: prints the install command and waits for you to type "yes".
// 3) index, then the 8 questions in questions.json (graded against grep-verified file:line), then a stale-after-edit check.
import { readFileSync, appendFileSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import readline from "node:readline/promises";
import path from "node:path";
import { TRIALS, cell, pct, writeResult } from "./lib/util.mjs";

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const root = path.resolve(arg("--repo") ?? path.join(TRIALS, "../.."));
const only = arg("--tool");
const { tools } = JSON.parse(readFileSync(path.join(TRIALS, "tools.json"), "utf8"));
const { questions, stale } = JSON.parse(readFileSync(path.join(TRIALS, "questions.json"), "utf8"));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const gh = (p) => fetch("https://api.github.com" + p, { headers: { "user-agent": "orbit-trial" } }).then((r) => (r.ok ? r.json() : null), () => null);
const run = (cmd) => { const t = performance.now(), r = spawnSync(cmd, { shell: true, cwd: root, encoding: "utf8", timeout: 600_000, maxBuffer: 1 << 26 });
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), code: r.status, sec: (performance.now() - t) / 1000 }; };
const ask = (t, q) => run(t.ask.replaceAll("{q}", JSON.stringify(q)));
// Pass: every expected file named in the answer, and (if the answer has "file:NN" or "file line NN" near it) a line within 3 of expected.
function grade(out, expect) {
  return expect.every((e) => {
    let i = out.indexOf(e.file);
    for (; i >= 0; i = out.indexOf(e.file, i + 1)) {
      const n = [...out.slice(i + e.file.length, i + e.file.length + 40).matchAll(/\d+/g)].map((m) => Number(m[0]));
      if (!n.length || n.some((x) => Math.abs(x - e.line) <= 3)) return true; // any mention of the file with a near line (or no line given)
    }
    return false;
  });
}

const results = [];
for (const t of tools.filter((x) => !only || x.name === only)) {
  const r = { name: t.name };
  let repo = t.repo, info = repo ? await gh(`/repos/${repo}`) : null;
  if (!repo) { // no repo pinned: show candidates, never pick one for you
    const s = await gh(`/search/repositories?q=${encodeURIComponent(t.search || t.name)}&per_page=5`);
    r.candidates = (s?.items ?? []).map((i) => `${i.full_name} (${i.license?.spdx_id ?? "no license"}, ${i.stargazers_count} stars, pushed ${i.pushed_at.slice(0, 10)}): ${(i.description ?? "").slice(0, 70)}`);
    r.verdict = "repo not pinned: pick one from the candidates, put it in tools.json, re-run";
  } else if (!info) r.verdict = `repo ${repo} not found via GitHub API`;
  else {
    r.repo = `${info.full_name}, license ${info.license?.spdx_id ?? "NONE"}, ${info.stargazers_count} stars, pushed ${info.pushed_at.slice(0, 10)}${info.archived ? ", ARCHIVED" : ""}`;
    if (!t.install && !t.ask) r.verdict = "commands not configured (README check needed)";
  }
  if (!r.verdict) {
    console.log(`\n${t.name}: ${r.repo}\nInstall command: ${t.install || "(none, already installed)"}`);
    if (t.install && (await rl.question('Type "yes" to run it (anything else skips this tool): ')).trim() !== "yes") r.verdict = "install not confirmed";
    else if (t.install && run(t.install).code) r.verdict = "install failed";
    else if (!t.ask) r.verdict = "ask command not configured";
    else {
      if (t.index) { const i = run(t.index); r.index = `${i.sec.toFixed(0)} s, exit ${i.code}`; }
      r.rows = questions.map((q) => { const a = ask(t, q.q); return { q: q.q, ok: grade(a.out, q.expect), sec: a.sec }; });
      // Stale-after-edit: add a new symbol, ask WITHOUT re-indexing, then re-index and ask again. The edit is always reverted.
      const f = path.join(root, stale.file);
      if (execFileSync("git", ["status", "--porcelain", "--", stale.file], { cwd: root, encoding: "utf8" }).trim()) r.stale = "skipped: " + stale.file + " has uncommitted changes";
      else try {
        appendFileSync(f, "\nexport const __trialStaleProbe = 1;\n");
        const exp = [{ file: stale.file, line: readFileSync(f, "utf8").split("\n").length - 1 }];
        const before = grade(ask(t, stale.q).out, exp);
        if (t.index) run(t.index);
        r.stale = `without re-index: ${before ? "found" : "STALE (missed it)"}; after re-index: ${t.index ? (grade(ask(t, stale.q).out, exp) ? "found" : "missed") : "no index command"}`;
      } finally { execFileSync("git", ["checkout", "--", stale.file], { cwd: root }); if (t.index) run(t.index); }
      r.verdict = "ran";
    }
  }
  results.push(r);
}
rl.close();
let md = `# Trial 4: code index tools\n\nRun ${new Date().toISOString()} on ${root}. Grading: answer names the expected file(s) and a line within 3 (questions.json, grep-verified).\n\n| Tool | Repo / license | Verdict | Index | Correct | Median ask | Stale-after-edit |\n|---|---|---|---|---|---|---|\n`;
for (const r of results) {
  const s = r.rows ?? [], ts = s.map((x) => x.sec).sort((a, b) => a - b);
  md += `| ${r.name} | ${cell(r.repo ?? "-")} | ${cell(r.verdict)} | ${r.index ?? "-"} | ${s.length ? `${s.filter((x) => x.ok).length}/${s.length} (${pct(s.filter((x) => x.ok).length / s.length)})` : "-"} | ${ts.length ? ts[ts.length >> 1].toFixed(1) + " s" : "-"} | ${cell(r.stale ?? "-")} |\n`;
}
for (const r of results) {
  if (r.candidates) md += `\n**${r.name} candidates:**\n${r.candidates.map((c) => "- " + c).join("\n")}\n`;
  if (r.rows) md += `\n**${r.name} per question:** ${r.rows.map((x, i) => `Q${i + 1} ${x.ok ? "ok" : "MISS"}`).join(", ")}\n`;
}
writeResult("code-index", md);
