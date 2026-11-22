// scrape_page disk side: robots.txt (via safeFetch), the per-domain gap, then the Scrapling helper (tools/scrapling/fetch.py) in its
// own process with a hard timeout. Rules: scrape-pure.ts.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { safeFetch } from "./memory";
import { logActivity } from "./activity";
import { helperFailure, helperLimits, parseStealthDomains, robotsAllows, stealthLog, stealthRefusal, waitMs, type Mode } from "./scrape-pure";

const last = new Map<string, number>(); // domain → last request time (this server process)
// tools/scrapling/setup.ps1 installs Scrapling into its own venv; ORBIT_PYTHON overrides, the system Python is the last resort.
const VENV = path.join(process.cwd(), "tools", "scrapling", ".venv", ...(process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]));
const PY = process.env.ORBIT_PYTHON || (existsSync(VENV) ? VENV : process.platform === "win32" ? "python" : "python3");
const HELPER = path.join(process.cwd(), "tools", "scrapling", "fetch.py");

async function robotsOk(url: URL): Promise<boolean> {
  try { const { res } = await safeFetch(`${url.origin}/robots.txt`, "text/plain", undefined, 300_000); return robotsAllows(await res.text(), url.pathname + url.search); }
  catch { return true; } // no robots.txt (or it fails to load) = no rules
}

export type Scraped = { url: string; title: string; text: string; status: number } | { error: string };
/** timeoutMs: the helper's hard limit (default 30 s fast, 90 s browser/stealth); the web ladder passes its rung budget. */
export async function scrapePage(raw: string, mode: Mode, select?: string, timeoutMs?: number): Promise<Scraped> {
  let url: URL;
  try { url = new URL(raw); } catch { return { error: "not a URL" }; }
  if (!/^https?:$/.test(url.protocol)) return { error: "only http(s) addresses" };
  const refusal = stealthRefusal(url, mode, parseStealthDomains(process.env.ORBIT_SCRAPE_STEALTH));
  if (refusal) return { error: refusal };
  if (!(await robotsOk(url))) return { error: `${url.hostname}'s robots.txt asks bots not to read ${url.pathname}; ORBIT respects that.` };
  const host = url.hostname.toLowerCase(), wait = waitMs(last.get(host), mode, Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last.set(host, Date.now());
  const lim = helperLimits(mode, timeoutMs);
  const out = await new Promise<Scraped>((resolve) => {
    const p = spawn(PY, [HELPER], { stdio: ["pipe", "pipe", "pipe"], timeout: lim.killMs, windowsHide: true });
    let so = "", se = "";
    p.stdout.on("data", (d) => (so += d)); p.stderr.on("data", (d) => (se = (se + d).slice(-2000)));
    p.on("error", (e) => resolve({ error: `Scrapling isn't installed (${e.message}). Run once: powershell -File tools\\scrapling\\setup.ps1` }));
    p.on("close", (code, signal) => {
      try { resolve(JSON.parse(so.trim().split("\n").pop() ?? "")); } catch {
        resolve({ error: helperFailure(code, signal, se, lim.killMs).error }); // only "isn't installed" switches the ladder's scraper rung off
      }
    });
    p.stdin.end(JSON.stringify({ url: url.toString(), mode, timeout: lim.requestS, retries: lim.retries, ...(select ? { select } : {}) }));
  });
  if (mode === "stealth") logActivity({ area: "core", title: stealthLog(url, !("error" in out)) });
  return out;
}
