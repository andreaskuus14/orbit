// Shared bits for the PC trial scripts: error rates, the ORBIT HTTP client, the markdown writer.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TRIALS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ORBIT = process.env.ORBIT_URL || "http://127.0.0.1:3000";
// Copy the Cookie header of a signed-in ORBIT tab (DevTools > Network) into ORBIT_COOKIE. It stays in this shell only.
export const orbitHeaders = (extra = {}) => ({ ...(process.env.ORBIT_COOKIE ? { cookie: process.env.ORBIT_COOKIE } : {}), ...extra });

export const norm = (s) => s.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/** Word and character error rate of `hyp` against `ref` (after norm); 0 = perfect, can exceed 1. */
export function errorRates(ref, hyp) {
  const r = norm(ref), h = norm(hyp), rw = r ? r.split(" ") : [], hw = h ? h.split(" ") : [];
  return { wer: rw.length ? lev(rw, hw) / rw.length : 0, cer: r.length ? lev([...r], [...h]) / r.length : 0 };
}

/** "id<TAB>sentence" lines of clips.txt -> { id, lang, text }[] */
export function parseClips(txt) {
  return txt.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).map((l) => {
    const [id, ...t] = l.split("\t"); return { id: id.trim(), lang: id.trim().slice(0, 2), text: t.join("\t").trim() };
  });
}

export const pct = (x) => (x * 100).toFixed(1) + "%";
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s[s.length >> 1] + s[(s.length - 1) >> 1]) / 2 : 0; };
export const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

export function writeResult(name, md) {
  const dir = path.join(TRIALS, "results"); mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name + ".md"); writeFileSync(f, md); console.log(md); console.log(`\nWrote ${f}`); return f;
}
