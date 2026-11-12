// Trial 29: ORBIT's current fetcher (readArticle: plain fetch, then hidden browser if the page is thin) vs Scrapling Fetcher and
// DynamicFetcher. Plain + browser rendering only; no stealth / anti-bot / CAPTCHA bypass. Public pages in pages.txt.
// Usage: node --experimental-strip-types --import ./lib/load.mjs scrape-trial.mjs   (scrape-trial.ps1 does this for you)
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { TRIALS, pct, mean, median, cell, writeResult } from "./lib/util.mjs";

const UA = "orbit-trial/1.0 (personal research; respects robots.txt)";
const pages = readFileSync(path.join(TRIALS, "pages.txt"), "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => { const [url, keys] = l.split("\t"); return { url, keys: (keys ?? "").split(";").map((k) => k.trim()).filter(Boolean) }; });

const robots = {};
async function allowed(url) { // User-agent: * Disallow prefixes only: enough to keep this script polite
  const u = new URL(url);
  if (!(u.origin in robots)) {
    const txt = await fetch(u.origin + "/robots.txt", { headers: { "user-agent": UA } }).then((r) => (r.ok ? r.text() : ""), () => "");
    let star = false; const dis = [];
    for (const l of txt.split(/\r?\n/)) { const m = /^\s*([\w-]+)\s*:\s*(.*?)\s*$/.exec(l); if (!m) continue;
      if (/^user-agent$/i.test(m[1])) star = m[2] === "*"; else if (star && /^disallow$/i.test(m[1]) && m[2]) dis.push(m[2]); }
    robots[u.origin] = dis;
  }
  return !robots[u.origin].some((p) => (u.pathname + u.search).startsWith(p));
}
const coverage = (text, keys) => (keys.length ? keys.filter((k) => text.toLowerCase().includes(k.toLowerCase())).length / keys.length : 1);

// ORBIT's real functions, loaded straight from src/lib (needs the repo's node_modules, as on the PC).
const { readArticle } = await import("../../src/lib/news.ts");
const res = {};
for (const p of pages) {
  res[p.url] = {};
  if (!(await allowed(p.url))) { res[p.url].orbit = { error: "disallowed by robots.txt" }; continue; }
  const t = performance.now();
  try { const a = await readArticle(p.url, 60_000, true); res[p.url].orbit = a ? { text: a.text, links: a.links.map((l) => l.url), sec: (performance.now() - t) / 1000 } : { error: "null (nothing readable)" }; }
  catch (e) { res[p.url].orbit = { error: e.message }; }
  await new Promise((r) => setTimeout(r, 3000));
}

const py = path.join(TRIALS, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (existsSync(py)) {
  const tmp = path.join(os.tmpdir(), "orbit-trial-pages.json"); writeFileSync(tmp, JSON.stringify(pages.map((p) => p.url)));
  const r = spawnSync(py, [path.join(TRIALS, "scrapling_run.py"), tmp], { encoding: "utf8", maxBuffer: 1 << 28, timeout: 30 * 60_000 });
  try { const s = JSON.parse(r.stdout); for (const u in s) Object.assign(res[u], s[u]); } catch { console.error("Scrapling run failed:", (r.stderr || "").slice(-400)); }
} else console.error("No .venv: run scrape-trial.ps1 first. Scrapling columns will be empty.");

// Source-link accuracy: up to 5 same-host links each fetcher returned; a link counts as good if it answers < 400 (robots respected).
async function linkOk(base, links) {
  const host = new URL(base).host, sample = [...new Set(links)].filter((l) => { try { return new URL(l).host === host; } catch { return false; } }).slice(0, 5);
  let ok = 0, n = 0;
  for (const l of sample) { if (!(await allowed(l))) continue; n++;
    try { if ((await fetch(l, { method: "HEAD", redirect: "follow", headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) })).status < 400) ok++; } catch {}
    await new Promise((r) => setTimeout(r, 1000)); }
  return n ? ok / n : null;
}
const names = { orbit: "ORBIT readArticle", fetcher: "Scrapling Fetcher", dynamic: "Scrapling DynamicFetcher" };
const agg = Object.fromEntries(Object.keys(names).map((k) => [k, { cov: [], sec: [], link: [], fail: 0 }]));
let rows = "";
for (const p of pages) {
  const cells = [];
  for (const k of Object.keys(names)) {
    const r = res[p.url][k];
    if (!r || r.error) { agg[k].fail++; cells.push(cell(r?.error ?? "not run")); continue; }
    const c = coverage(r.text, p.keys), l = await linkOk(p.url, r.links);
    agg[k].cov.push(c); agg[k].sec.push(r.sec); if (l != null) agg[k].link.push(l);
    cells.push(`${pct(c)} / ${r.sec.toFixed(1)} s / ${r.text.length} ch / links ${l == null ? "-" : pct(l)}`);
  }
  rows += `| ${cell(p.url)} | ${p.keys.length} | ${cells.join(" | ")} |\n`;
}
let md = `# Trial 29: Scrapling vs ORBIT fetcher\n\nRun ${new Date().toISOString()}. Plain and browser-rendered fetching only; no stealth or bot-wall bypass; robots.txt respected (disallowed pages are skipped and shown as such).\n\n` +
  `| Fetcher | Mean completeness | Median time | Link accuracy | Failed/refused |\n|---|---|---|---|---|\n` +
  Object.entries(names).map(([k, n]) => `| ${n} | ${pct(mean(agg[k].cov))} | ${median(agg[k].sec).toFixed(1)} s | ${agg[k].link.length ? pct(mean(agg[k].link)) : "-"} | ${agg[k].fail}/${pages.length} |`).join("\n") +
  `\n\nCompleteness = share of the expected key strings (pages.txt) found in the extracted text. Link accuracy = up to 5 same-host links per page that answer < 400. ` +
  `A page that a fetcher cannot read without bypassing a bot wall counts as failed, on purpose.\n\n## Per page (completeness / time / text length / links)\n\n| Page | Keys | ${Object.values(names).join(" | ")} |\n|---|---|---|---|---|\n${rows}`;
writeResult("scrapling", md);
