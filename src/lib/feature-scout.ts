// FEATURE SCOUT, IO half: the public fetchers, the store (<ORBIT data dir>/scout/features.json), the 6-hourly run and the owner's
// actions. Rules: feature-scout-pure.ts. Read-only: every request is a fixed public URL (no owner data in it); nothing is installed,
// downloaded or started here. "Prototype it" only creates an agent task, on his click.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { safeFetch } from "./memory";
import { stopAllOn } from "./stop-all";
import { usageHold } from "./usage-meter";
import { logActivity } from "./activity";
import {
  MAX_BATCH, classifyLicense, dedupe, fitFilter, glowingCount, mergeRun, painPoints, parseAwesomeMcp, parseGithubSearch, parseHfModels, parseHfPapers,
  parseOllamaLibrary, parseOllamaManifest, parseScores, prototypeRequest, rank, scoreGate, scorePrompt, scoutGate, MCP_RELEVANT, SCORE_SYSTEM,
  type Candidate, type JobRow, type Raw,
} from "./feature-scout-pure";

type Store = { v: 1; candidates: Candidate[]; seen: Record<string, string>; mcpBaseline?: boolean; lastAttempt?: string; lastOk?: string; status?: string; lastError?: string };
const dir = () => path.join(orbitDataDir(), "scout");
const FILE = () => path.join(dir(), "features.json");
const g = globalThis as unknown as { __orbitFeatScoutWrite?: Promise<unknown>; __orbitFeatScoutBusy?: boolean };
const UA = "ORBIT/0.2 (personal feature scout; public metadata only)";

async function load(): Promise<Store> {
  let raw: string;
  try { raw = await readFile(FILE(), "utf8"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { v: 1, candidates: [], seen: {} };
    throw e;
  }
  const s = JSON.parse(raw) as Store; // a broken file throws instead of silently forgetting what was seen
  if (!s || s.v !== 1 || !Array.isArray(s.candidates) || typeof s.seen !== "object") throw new Error("scout/features.json is unreadable");
  return s;
}
function update<T>(fn: (s: Store) => T): Promise<T> {
  const p = (g.__orbitFeatScoutWrite ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load();
    const out = fn(s);
    await mkdir(dir(), { recursive: true });
    await writeFile(FILE() + ".tmp", JSON.stringify(s));
    await rename(FILE() + ".tmp", FILE());
    return out;
  });
  g.__orbitFeatScoutWrite = p;
  return p;
}

/* ---------- fetchers (each returns [] on failure and reports why) ---------- */

const getText = async (url: string, accept: string, max = 3_000_000) => new TextDecoder().decode((await safeFetch(url, accept, UA, max, 20_000, undefined, true)).body);
const getJson = async (url: string, max?: number) => JSON.parse(await getText(url, "application/json", max)) as unknown;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

const HF_EXPAND = ["safetensors", "pipeline_tag", "tags", "createdAt", "likes", "trendingScore", "cardData", "gguf"].map((e) => `expand%5B%5D=${e}`).join("&");
export const fetchHfModels = async () => parseHfModels(await getJson(`https://huggingface.co/api/models?sort=trendingScore&limit=60&${HF_EXPAND}`));
export const fetchHfPapers = async () => parseHfPapers(await getJson("https://huggingface.co/api/daily_papers?limit=30")).sort((a, b) => b.popularity - a.popularity).slice(0, 8);
/** GitHub search (unauthenticated: 10 searches a minute, so a small gap between them). New repos in ORBIT's topics. */
export const GH_QUERIES = ["topic:mcp-server stars:>=40", "topic:local-llm stars:>=40", "topic:text-to-speech stars:>=30", "topic:comfyui stars:>=30", "topic:roblox stars:>=10", "topic:speech-recognition stars:>=30"];
export async function fetchGithub(): Promise<Raw[]> {
  const out: Raw[] = [];
  for (const q of GH_QUERIES) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`${q} created:>${daysAgo(30)}`)}&sort=stars&order=desc&per_page=10`;
    out.push(...parseGithubSearch(await getJson(url, 2_000_000), q.startsWith("topic:mcp") ? "mcp" : "tool"));
    await wait(2500);
  }
  return out;
}
export const fetchOllama = async () => parseOllamaLibrary(await getText("https://ollama.com/library?sort=newest", "text/html"), 25);
export const fetchAwesomeMcp = async () => parseAwesomeMcp(await getText("https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md", "text/plain", 4_000_000));

/** Ollama: the registry manifest's license layer (the library page has none) and the download size. */
async function ollamaLicense(r: Raw): Promise<Raw> {
  const name = r.key.slice("ollama:".length);
  try {
    let man: ReturnType<typeof parseOllamaManifest> = null;
    for (const tag of ["latest", ...(r.paramsB ? [`${r.paramsB}b`] : [])]) { // not every model has a "latest" tag
      man = await getJson(`https://registry.ollama.ai/v2/library/${encodeURIComponent(name)}/manifests/${tag}`, 3_000_000).then(parseOllamaManifest, () => null);
      if (man) break;
    }
    if (!man?.licenseDigest) return r;
    const text = await getText(`https://registry.ollama.ai/v2/library/${encodeURIComponent(name)}/blobs/${man.licenseDigest}`, "text/plain", 200_000);
    return { ...r, license: text.slice(0, 4000) };
  } catch { return r; }
}
/** A GitHub repo's SPDX license (awesome-list entries carry none). 60 lookups an hour unauthenticated: callers cap it. */
async function githubLicense(r: Raw): Promise<Raw> {
  try {
    const j = (await getJson(`https://api.github.com/repos/${r.name}`, 500_000)) as { license?: { spdx_id?: string } | null; created_at?: string; stargazers_count?: number; archived?: boolean; topics?: string[] };
    const spdx = j.license?.spdx_id && j.license.spdx_id !== "NOASSERTION" ? j.license.spdx_id : j.license ? "other" : undefined;
    return { ...r, ...(spdx ? { license: spdx } : {}), popularity: Number(j.stargazers_count ?? 0) || 0, tags: [...r.tags, ...(j.topics ?? []).slice(0, 10)] };
  } catch { return r; }
}

/* ---------- the run ---------- */

const g2 = g as unknown as { __orbitFeatScoutAbort?: AbortController };
export type RunOut = { added: number; status: string };

/** One scout run. lane "background" from the scheduler; the owner's "Check now" too (it lists only; same Haiku call). */
export async function runFeatureScout(sb: SupabaseClient | null, userId: string | null): Promise<RunOut> {
  if (g.__orbitFeatScoutBusy) throw new Error("The feature scout is already running");
  g.__orbitFeatScoutBusy = true;
  const ac = (g2.__orbitFeatScoutAbort = new AbortController());
  const now = Date.now(), at = new Date(now).toISOString();
  try {
    const st = await update((s) => { s.lastAttempt = at; return { seen: { ...s.seen }, mcpBaseline: !!s.mcpBaseline }; });
    const errors: string[] = [], counts: Record<string, number> = {};
    const take = async (name: string, f: () => Promise<Raw[]>) => {
      if (ac.signal.aborted || stopAllOn()) return [];
      try { const r = await f(); counts[name] = r.length; return r; } catch (e) { errors.push(`${name}: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`); return []; }
    };
    const hf = await take("Hugging Face", fetchHfModels), papers = await take("HF papers", fetchHfPapers), gh = await take("GitHub", fetchGithub), ol = await take("Ollama", fetchOllama);
    const mcpAll = await take("awesome-mcp", fetchAwesomeMcp);
    // The awesome list has ~5000 entries: the first run only remembers them; later runs look at the new, relevant ones.
    const mcpNew = st.mcpBaseline ? dedupe(mcpAll, st.seen).filter((r) => MCP_RELEVANT.test(`${r.name} ${r.what}`)).slice(0, 8) : [];
    const baselineKeys = !st.mcpBaseline && mcpAll.length ? mcpAll : [];

    const fresh = dedupe([...hf, ...ol, ...gh, ...(await Promise.all(mcpNew.map(githubLicense))), ...papers], st.seen);
    const dropped: Raw[] = [...baselineKeys];
    let kept: Candidate[] = [];
    for (const r of fresh) {
      const v = fitFilter(r, now);
      if (!v.keep) { dropped.push(r); continue; }
      kept.push({ ...v.c, score: 0, improves: "", why: "", status: "new", foundAt: at });
    }
    kept = kept.sort((a, b) => Number(b.ready) - Number(a.ready) || b.popularity - a.popularity).slice(0, MAX_BATCH);
    // Ollama licenses: only for the few that passed (two small registry reads each). Re-check readiness with the real license.
    kept = await Promise.all(kept.map(async (c) => {
      if (c.source !== "ollama") return c;
      const lic = classifyLicense((await ollamaLicense(c)).license);
      return { ...c, licenseClass: lic.cls, licenseLabel: lic.label, ready: lic.cls === "commercial-ok" && c.fit !== "unknown" };
    }));

    let added: Candidate[] = [];
    if (kept.length && !stopAllOn() && !ac.signal.aborted) {
      const pains = sb && userId ? painPoints(await jobRows(sb, userId)) : [];
      const scores = await scoreBatch(scorePrompt(kept, pains), kept.length, ac.signal);
      added = kept.flatMap((c, i) => { const s = scores.get(i); return s && scoreGate(c, s) ? [{ ...c, ...s }] : []; });
      dropped.push(...kept.filter((_, i) => !added.some((a) => a.key === kept[i].key))); // scored low: seen, never shown again
    }
    const src = Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", ");
    const status = `${src || "no source answered"} · ${fresh.length} new · ${added.length} on the board${!st.mcpBaseline && mcpAll.length ? " · MCP list baselined" : ""}${errors.length ? ` · failed: ${errors.join("; ")}` : ""}`.slice(0, 400);
    await update((s) => {
      const m = mergeRun(s.candidates, s.seen, added, dropped, at);
      s.candidates = m.board; s.seen = m.seen; s.lastOk = at; s.status = status; s.lastError = errors.length ? errors.join("; ").slice(0, 300) : undefined;
      if (mcpAll.length) s.mcpBaseline = true;
    });
    if (added.length) logActivity({ area: "system", title: `Feature scout: ${added.length} new candidate${added.length === 1 ? "" : "s"} in OPERATIONS → Scout`, detail: added.slice(0, 5).map((c) => c.name).join(", ") });
    return { added: added.length, status };
  } catch (e) {
    const msg = ac.signal.aborted ? "Stopped" : e instanceof Error ? e.message : String(e);
    await update((s) => { s.lastError = msg.slice(0, 300); }).catch(() => {});
    throw new Error(msg);
  } finally { g.__orbitFeatScoutBusy = false; g2.__orbitFeatScoutAbort = undefined; }
}

async function jobRows(sb: SupabaseClient, userId: string): Promise<JobRow[]> {
  const { data } = await sb.from("job_runs").select("job, status, started_at, finished_at").eq("user_id", userId).gte("started_at", new Date(Date.now() - 14 * 86400_000).toISOString()).limit(2000);
  return (data ?? []) as JobRow[];
}

/** ONE Claude call per batch on the fast model (model-routing FAST_PURPOSES "scout.features"); one retry on the default model if the JSON fails. */
async function scoreBatch(prompt: string, n: number, signal: AbortSignal) {
  const { askClaude, MODEL } = await import("./claude");
  const r = await askClaude(prompt, SCORE_SYSTEM, { lane: "background", purpose: "scout.features", timeoutMs: 3 * 60_000, signal });
  const first = parseScores(r.text, n);
  if (first) return first;
  const again = await askClaude(prompt, SCORE_SYSTEM, { lane: "background", purpose: "scout.features", model: MODEL, timeoutMs: 3 * 60_000, signal });
  const second = parseScores(again.text, n);
  if (!second) throw new Error("The scout's scoring answer wasn't valid JSON");
  return second;
}

/** From the scheduler tick. Not awaited (a run takes a minute or two); quiet when not due. */
export async function maybeFeatureScout(sb: SupabaseClient, userId: string | undefined, allowed: boolean): Promise<void> {
  const s = await load().catch(() => null);
  if (!s) return; // unreadable store: the board shows the error; don't overwrite what was seen
  const gate = scoutGate({ env: process.env.ORBIT_SCOUT, stopAll: stopAllOn(), hold: usageHold(), allowed, busy: !!g.__orbitFeatScoutBusy, lastAttempt: s.lastAttempt, now: Date.now() });
  if (!gate.run) return;
  console.log("[orbit] feature scout starting");
  await runFeatureScout(sb, userId ?? null).then((r) => console.log(`[orbit] feature scout: ${r.status}`), (e) => console.error("[orbit] feature scout failed:", e instanceof Error ? e.message : e));
}

/** Stop-all: cancel a running scout. */
export function abortFeatureScout() { g2.__orbitFeatScoutAbort?.abort(); }

/* ---------- the board and the owner's actions ---------- */

export async function scoutBoard() {
  const s = await load();
  const candidates = rank(s.candidates.filter((c) => c.status !== "dismissed"));
  return { candidates, glowing: glowingCount(candidates), lastOk: s.lastOk ?? null, lastAttempt: s.lastAttempt ?? null, status: s.status ?? null, lastError: s.lastError ?? null,
    busy: !!g.__orbitFeatScoutBusy, off: process.env.ORBIT_SCOUT?.trim() === "0" };
}
export const scoutGlowing = async () => glowingCount((await load().catch(() => ({ candidates: [] as Candidate[] }))).candidates);

export async function markCandidate(key: string, status: "opened" | "dismissed"): Promise<boolean> {
  return update((s) => { const c = s.candidates.find((x) => x.key === key); if (!c) return false; if (status === "dismissed" || c.status === "new") c.status = status; return true; });
}

/** "Prototype it" (his click): one agent task for Nova. Returns the task id. The task itself asks before downloading or installing. */
export async function prototypeCandidate(sb: SupabaseClient, userId: string, key: string): Promise<{ taskId: string } | { error: string; status: number }> {
  if (stopAllOn()) return { error: "ORBIT is paused (Stop-all is on)", status: 409 };
  const c = (await load()).candidates.find((x) => x.key === key);
  if (!c) return { error: "Not found", status: 404 };
  if (!c.ready) return { error: "Only commercial-OK candidates that fit the GPU can be prototyped", status: 400 };
  if (c.taskId) return { taskId: c.taskId };
  const { title, request } = prototypeRequest(c);
  const { data, error } = await sb.from("tasks").insert({ user_id: userId, agent: "nova", title, request }).select("id").single();
  if (error || !data) return { error: error?.message ?? "Could not create the task", status: 400 };
  await update((s) => { const x = s.candidates.find((y) => y.key === key); if (x) { x.status = "prototyped"; x.taskId = data.id; } });
  void import("./agents").then((m) => m.kickQueue(sb, userId));
  logActivity({ area: "agents", title: `Feature scout: prototype task for ${c.name}`, link: { task: data.id } });
  return { taskId: data.id };
}
