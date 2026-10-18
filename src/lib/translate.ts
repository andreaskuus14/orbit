import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { askClaude, FAST_MODEL, type ClaudeResult } from "./claude";
import { usageHold } from "./usage-meter";
import { CACHE_MAX, MAX_BATCH, TRANSLATE_SYSTEM, cacheKey, cleanTitle, looksEnglish, lruGet, lruSet, parseTranslations, translatePrompt } from "./translate-pure";

// Headline → English, for the INTELLIGENCE country card. One haiku call per batch of ≤20 uncached headlines;
// results cached in memory and in <ORBIT data dir>/translations.json (sha1(title) → English, LRU-bounded).

const file = () => {
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit");
  return path.join(process.env.ORBIT_DATA_DIR?.trim() || local, "translations.json");
};
const g = globalThis as unknown as { __orbitTr?: Promise<Map<string, string>>; __orbitTrSave?: Promise<unknown> };

function cache() {
  return (g.__orbitTr ??= readFile(file(), "utf8")
    .then((s) => { const o = JSON.parse(s); return new Map(Object.entries(o && typeof o === "object" ? o : {}).filter(([, v]) => typeof v === "string").slice(-CACHE_MAX) as [string, string][]); })
    .catch(() => new Map<string, string>())); // missing or corrupt: it's only a cache
}
function save(m: Map<string, string>) {
  g.__orbitTrSave = (g.__orbitTrSave ?? Promise.resolve()).catch(() => {}).then(async () => {
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(Object.fromEntries(m)));
    await rename(file() + ".tmp", file());
  }).catch((e) => console.error("[orbit] translation cache not saved", e));
}

/** English title per input (the original where it already looks English or the call failed). */
export async function translateTitles(titles: string[], signal?: AbortSignal): Promise<{ titles: string[]; failed: boolean; usage?: ClaudeResult }> {
  const m = await cache();
  const out = titles.map((t) => cleanTitle(t));
  const todo: number[] = [];
  out.forEach((t, i) => {
    if (!t || looksEnglish(t)) return;
    const hit = lruGet(m, cacheKey(t));
    if (hit !== undefined) out[i] = hit; else todo.push(i);
  });
  const batch = todo.slice(0, MAX_BATCH);
  if (!batch.length) return { titles: out, failed: false };
  if (usageHold()) return { titles: out, failed: true }; // background lane: originals for now, translated once usage is back under the budget
  const originals = batch.map((i) => out[i]);
  try {
    const r = await askClaude(translatePrompt(originals), TRANSLATE_SYSTEM, { lane: "background", model: FAST_MODEL, signal, timeoutMs: 60_000, purpose: "translate" });
    const { titles: tr, got } = parseTranslations(r.text, originals);
    tr.forEach((t, j) => { out[batch[j]] = t; if (got[j]) lruSet(m, cacheKey(originals[j]), t); }); // a missing answer isn't cached: retried next time
    if (got.some(Boolean)) save(m);
    return { titles: out, failed: !got.every(Boolean) || todo.length > batch.length, usage: r };
  } catch (e) {
    console.error("[orbit] headline translation failed", e);
    return { titles: out, failed: true };
  }
}
