// Estonian e-Business Register enrichment, IO side (rules and tests: registry-pure.ts, tests/registry.test.ts).
// Weekly (after his first "Get registry data" click) it downloads the free open-data bulk files from RIK (CC BY 4.0), streams
// them (zip → lines, nothing big kept in memory or on disk) into <data>/registry/index.tsv, then matches every BUSINESS
// prospect. Read-only towards the outside: public files in, nothing about his leads goes out. No logins, no paid lookups.
// Board members (personal data) are kept in <data>/registry/people.json for matched leads only; this file is read only by
// the lead card route and by the peopleBlock guard, never by a prompt builder.
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, rename, writeFile, open } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { once } from "node:events";
import zlib from "node:zlib";
import { orbitDataDir } from "./data-dir.ts";
import { loadCrm, updateCrm } from "./prospect-crm.ts";
import { stopAllOn } from "./stop-all.ts";
import {
  IDLE, PAGE_URL, arraySplitter, basicParser, boardOf, decide, decodeRow, emtakParser, encodeRow, figuresParser, isLinked, keyWords, leadPlace, peopleIn,
  pickFiles, refreshDue, refreshMatch, reportsParser, rowJoiner, splitRow, toMatch, type Figures, type IndexRow, type Person, type RegMatch, type RunState,
} from "./registry-pure.ts";

const DIR = () => path.join(orbitDataDir(), "registry");
const F = { index: () => path.join(DIR(), "index.tsv"), figures: () => path.join(DIR(), "figures.json"), state: () => path.join(DIR(), "state.json"), people: () => path.join(DIR(), "people.json") };
const UA = "ORBIT personal assistant (+local; weekly open-data download)";
const g = globalThis as unknown as { __orbitRegistry?: Promise<void> | null };

async function writeAtomic(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file + ".tmp", text);
  await rename(file + ".tmp", file);
}
const readJson = async <T>(file: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw e; }
};
export const registryState = () => readJson<RunState>(F.state(), IDLE).then((s) => ({ ...IDLE, ...s }));
export const updateRegistryState = (patch: Partial<Pick<RunState, "on">>) => setState(patch);
const setState = async (patch: Partial<RunState>) => { const s = { ...(await registryState()), ...patch }; await writeAtomic(F.state(), JSON.stringify(s)); return s; };
export const running = () => !!g.__orbitRegistry;

// ---- Download + unzip (one entry, streamed) ---------------------------------------------------------

async function get(url: string, since?: string): Promise<{ body: Readable; modified: string } | "same"> {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...(since && { "If-Modified-Since": since }) }, signal: AbortSignal.timeout(15 * 60_000), redirect: "follow" });
  if (res.status === 304) return "same";
  if (!res.ok || !res.body) throw new Error(`the registry answered ${res.status} for ${path.basename(new URL(url).pathname)}`);
  if (new URL(res.url).host !== new URL(url).host) throw new Error("the registry redirected somewhere else");
  return { body: Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), modified: res.headers.get("last-modified") ?? "" };
}
/** The first file inside a zip stream, inflated as it arrives (local header, then deflate; the rest is ignored). */
export function unzipFirst(src: Readable): Readable {
  const out = zlib.createInflateRaw();
  void (async () => {
    let head = Buffer.alloc(0), started = false;
    for await (const c of src as AsyncIterable<Buffer>) {
      if (out.destroyed || out.writableEnded) break;
      if (!started) {
        head = Buffer.concat([head, c]);
        if (head.length < 30) continue;
        if (head.readUInt32LE(0) !== 0x04034b50 || head.readUInt16LE(8) !== 8) throw new Error("the registry file isn't the zip we expect");
        const n = 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
        if (head.length < n) continue;
        started = true;
        if (!out.write(head.subarray(n))) await once(out, "drain");
        continue;
      }
      if (!out.write(c)) await once(out, "drain");
    }
    if (!out.writableEnded) out.end();
  })().catch((e) => out.destroy(e));
  out.on("close", () => src.destroy());
  return out;
}
/** Each CSV row (header first) of a zipped ;-CSV. */
async function eachRow(body: Readable, fn: (r: string[], header: boolean) => boolean | void) {
  const rl = readline.createInterface({ input: unzipFirst(body).setEncoding("utf8"), crlfDelay: Infinity });
  const join = rowJoiner();
  let first = true, n = 0;
  for await (const line of rl) {
    const row = join(line);
    if (row === null) continue;
    if (fn(splitRow(row), first) === false) { rl.close(); break; }
    first = false;
    if (++n % 50_000 === 0 && stopAllOn()) throw new Error("Stop-all is on");
  }
}

// ---- Index build ----------------------------------------------------------------------------------

type FigStore = { files: string[]; byCode: Record<string, Figures> };

/** Annual-report files → per company figures from its latest report. Re-read only when a file changed (they update monthly). */
async function readFigures(files: NonNullable<ReturnType<typeof pickFiles>>, seen: Record<string, string>): Promise<{ store: FigStore; seen: Record<string, string> }> {
  const old = await readJson<FigStore>(F.figures(), { files: [], byCode: {} });
  const urls = [files.reports, files.emtak, ...files.figures.map((f) => f.url)].filter((u): u is string => !!u);
  if (!files.reports || !files.figures.length) return { store: old, seen };
  const same = urls.every((u) => old.files.includes(u) && seen[u]);
  if (same) {
    const probe = await get(files.reports, seen[files.reports]);
    if (probe === "same") return { store: old, seen };
    probe.body.destroy();
  }
  const years = new Set(files.figures.map((f) => f.year)), next = { ...seen };
  const reports = new Map<string, { code: string; year: number }>();
  const r1 = await get(files.reports) as { body: Readable; modified: string };
  let p1: ReturnType<typeof reportsParser> = null;
  await eachRow(r1.body, (r, h) => { if (h) { p1 = reportsParser(r, years); if (!p1) throw new Error("the reports file has new columns"); return; } const x = p1!(r); if (x) reports.set(x.id, { code: x.code, year: x.year }); });
  next[files.reports] = r1.modified;
  const emtak = new Map<string, { emtak: string; v: Figures["emtakV"] }>();
  if (files.emtak) {
    const r2 = await get(files.emtak) as { body: Readable; modified: string };
    let p2: ReturnType<typeof emtakParser> = null;
    await eachRow(r2.body, (r, h) => { if (h) { p2 = emtakParser(r); if (!p2) throw new Error("the EMTAK file has new columns"); return; } const x = p2!(r); if (x && reports.has(x.id)) emtak.set(x.id, { emtak: x.emtak, v: x.v }); });
    next[files.emtak] = r2.modified;
  }
  const vals = new Map<string, { revenue: number | null; staff: number | null }>();
  for (const f of files.figures) {
    const r3 = await get(f.url) as { body: Readable; modified: string };
    let p3: ReturnType<typeof figuresParser> = null;
    await eachRow(r3.body, (r, h) => {
      if (h) { p3 = figuresParser(r); if (!p3) throw new Error("the key-figures file has new columns"); return; }
      const x = p3!(r);
      if (!x || !reports.has(x.id)) return;
      const v = vals.get(x.id) ?? { revenue: null, staff: null };
      if (v[x.what] === null) v[x.what] = x.value;
      vals.set(x.id, v);
    });
    next[f.url] = r3.modified;
  }
  const byCode: Record<string, Figures> = {}, from = new Map<string, number>();
  for (const [id, r] of reports) { // latest year wins; within a year the later report (bigger id) wins
    const cur = byCode[r.code], v = vals.get(id), e = emtak.get(id);
    if (!v && !e) continue;
    if (cur && (cur.year > r.year || (cur.year === r.year && from.get(r.code)! > Number(id)))) continue;
    byCode[r.code] = { emtak: e?.emtak ?? "", emtakV: e?.v ?? "", revenue: v?.revenue ?? null, staff: v?.staff ?? null, year: r.year };
    from.set(r.code, Number(id));
  }
  const store = { files: urls, byCode };
  await writeAtomic(F.figures(), JSON.stringify(store));
  return { store, seen: next };
}

/** Basic data (daily file) + figures → index.tsv. Returns the number of companies. */
async function buildIndex(url: string, figs: FigStore): Promise<number> {
  const r = await get(url) as { body: Readable; modified: string };
  await mkdir(DIR(), { recursive: true });
  const fh = await open(F.index() + ".tmp", "w");
  let parse: ReturnType<typeof basicParser> = null, n = 0, lines: string[] = [];
  try {
    await eachRow(r.body, (row, h) => {
      if (h) { parse = basicParser(row); if (!parse) throw new Error("the basic-data file has new columns"); return; }
      const x = parse!(row);
      if (!x) return;
      const f = figs.byCode[x.code];
      lines.push(encodeRow(f ? { ...x, emtak: f.emtak, emtakV: f.emtakV, revenue: f.revenue, staff: f.staff, year: f.year } : x)); n++;
    });
    for (let i = 0; i < lines.length; i += 20_000) await fh.write(lines.slice(i, i + 20_000).join("\n") + "\n");
    lines = [];
  } finally { await fh.close(); }
  if (n < 1000) throw new Error("the basic-data file looked empty; kept the old index");
  await rename(F.index() + ".tmp", F.index());
  return n;
}

// ---- Matching ---------------------------------------------------------------------------------

type Lead = { id: string; name: string; notes?: string | null };
/** Streams the index once: candidates share a key word with a lead (or carry a code we already linked). */
export async function scanIndex(leads: Lead[], codes: Set<string>): Promise<{ cands: Map<string, IndexRow[]>; byCode: Map<string, IndexRow> }> {
  const byWord = new Map<string, number[]>();
  leads.forEach((l, i) => { for (const w of keyWords(l.name)) byWord.set(w, [...(byWord.get(w) ?? []), i]); });
  const cands = new Map<string, IndexRow[]>(), byCode = new Map<string, IndexRow>();
  const rl = readline.createInterface({ input: createReadStream(F.index(), "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    const row = decodeRow(line);
    if (!row) continue;
    if (codes.has(row.code)) byCode.set(row.code, row);
    const hit = new Set<number>();
    for (const w of keyWords(row.name)) for (const i of byWord.get(w) ?? []) hit.add(i);
    for (const i of hit) { const id = leads[i].id; const list = cands.get(id) ?? []; if (list.length < 200) list.push(row); cands.set(id, list); }
  }
  return { cands, byCode };
}

/** Match these prospects against the index and save the result on each lead's CRM record. */
export async function matchLeads(leads: Lead[], at = new Date().toISOString()) {
  const crm = await loadCrm();
  const linked = new Map(leads.flatMap((l) => { const m = crm[l.id]?.registry; return isLinked(m) ? [[l.id, m.info.code] as const] : []; }));
  const { cands, byCode } = await scanIndex(leads, new Set(linked.values()));
  const out = new Map<string, RegMatch>();
  for (const l of leads) {
    const prev = crm[l.id]?.registry;
    if (isLinked(prev)) { out.set(l.id, refreshMatch(prev, byCode.get(prev.info.code) ?? null, at)); continue; } // his pick or a clear match stays; status refreshed
    out.set(l.id, toMatch(decide({ name: l.name, place: leadPlace(l.notes) }, cands.get(l.id) ?? []), at));
  }
  await updateCrm((s) => { for (const [id, m] of out) if (s[id]) s[id] = { ...s[id], registry: m }; });
  return out;
}

/** His pick among the options (or a code he typed): a confirmed link. */
export async function pickMatch(id: string, code: string) {
  const { byCode } = await scanIndex([], new Set([code]));
  const row = byCode.get(code);
  if (!row) return "That registry code isn't in the current registry data";
  const m: RegMatch = { ...refreshMatch({ state: "picked", score: 100, checkedAt: "" }, row, new Date().toISOString()), state: "picked" };
  const ok = await updateCrm((s) => { if (!s[id]) return false; s[id] = { ...s[id], registry: m }; return true; });
  if (!ok) return "Not found";
  if (m.info?.formShort !== "FIE") void lookUpBoards(new Map([[id, code]]), "add").catch(() => {});
  return m;
}

// ---- Board members (personal data) -----------------------------------------------------------------

type People = Record<string, { code: string; board: Person[]; at: string }>;
/** Only the lead card route and peopleBlock read this. */
export const peopleOf = async (prospectId: string): Promise<Person[]> => (await readJson<People>(F.people(), {}))[prospectId]?.board ?? [];

/** Streams the persons file once for the given prospect → code pairs (FIE leads are skipped: they have no board). Data minimisation:
 *  only current board members of companies in his pipeline are kept; entries of leads no longer linked are dropped. */
export async function lookUpBoards(want: Map<string, string>, mode: "all" | "add" = "all") {
  const page = await fetch(PAGE_URL, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) }).then((r) => r.text());
  const url = pickFiles(page)?.persons;
  const codes = new Set(want.values());
  const found = new Map<string, Person[]>();
  if (url && codes.size) {
    const r = await get(url) as { body: Readable; modified: string };
    const split = arraySplitter();
    const text = unzipFirst(r.body).setEncoding("utf8");
    for await (const chunk of text as AsyncIterable<string>) {
      for (const o of split(chunk)) {
        const code = /"ariregistri_kood"\s*:\s*"?(\d{8})/.exec(o.slice(0, 200))?.[1];
        if (!code || !codes.has(code)) continue;
        const b = boardOf(JSON.parse(o));
        if (b) found.set(b.code, b.board);
      }
      if (found.size === codes.size) { text.destroy(); break; }
      if (stopAllOn()) { text.destroy(); throw new Error("Stop-all is on"); }
    }
  }
  const at = new Date().toISOString(), old = await readJson<People>(F.people(), {});
  // "all" (weekly run): only leads linked now are kept, so a lead that left the pipeline or lost its match loses its board too.
  const next: People = mode === "add" ? { ...old } : {};
  for (const [id, code] of want) next[id] = found.has(code) ? { code, board: found.get(code)!, at } : old[id]?.code === code ? old[id] : { code, board: [], at };
  await writeAtomic(F.people(), JSON.stringify(next));
}

/** GDPR guard before any model call or draft: "" or the refusal. The lead's own business name is exempt (see peopleIn). */
export async function peopleBlock(prospectId: string, text: string, ownName: string): Promise<string> {
  const people = await peopleOf(prospectId).catch(() => []);
  const { PEOPLE_REFUSAL } = await import("./registry-pure.ts");
  return peopleIn(text, people, ownName).length ? PEOPLE_REFUSAL : "";
}

// ---- The run -----------------------------------------------------------------------------------------

/** One full refresh. `prospects` = his BUSINESS prospects (id, name, notes). One at a time; progress in state.json. */
export function runRefresh(prospects: () => Promise<Lead[]>): Promise<void> {
  if (g.__orbitRegistry) return g.__orbitRegistry;
  const p = (async () => {
    const startedAt = new Date().toISOString();
    let s = await setState({ on: true, stage: 0, startedAt, error: "" });
    try {
      if (stopAllOn()) throw new Error("Stop-all is on");
      const page = await fetch(PAGE_URL, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
      if (!page.ok) throw new Error(`the registry page answered ${page.status}`);
      const files = pickFiles(await page.text());
      if (!files) throw new Error("the registry download page changed; the files weren't found");
      s = await setState({ stage: 1 });
      const { store, seen } = await readFigures(files, s.files);
      s = await setState({ stage: 2, files: seen });
      const companies = await buildIndex(files.basic, store);
      s = await setState({ stage: 3, companies });
      const leads = await prospects();
      const res = await matchLeads(leads);
      const v = [...res.values()];
      const counts = { checked: v.length, matched: v.filter((m) => isLinked(m) && m.state !== "gone").length, ambiguous: v.filter((m) => m.state === "ambiguous").length, none: v.filter((m) => m.state === "none" || m.state === "no-place").length };
      s = await setState({ stage: 4, ...counts });
      const want = new Map([...res].flatMap(([id, m]) => (isLinked(m) && m.state !== "gone" && m.info.formShort !== "FIE" ? [[id, m.info.code] as const] : [])));
      await lookUpBoards(want);
      await setState({ stage: -1, finishedAt: new Date().toISOString() });
    } catch (e) {
      await setState({ stage: -1, error: e instanceof Error ? e.message.slice(0, 200) : "unknown error", finishedAt: s.finishedAt });
    } finally { g.__orbitRegistry = null; }
  })();
  g.__orbitRegistry = p;
  return p;
}

/** Scheduler tick: the weekly refresh once he turned it on. Not awaited by the tick; never throws. */
export async function maybeWeeklyRegistry(prospects: () => Promise<Lead[]>, now = Date.now()) {
  try {
    if (running() || stopAllOn()) return;
    const s = await registryState();
    if (s.stage >= 0 && Date.now() - Date.parse(s.startedAt ?? "") > 3 * 3_600_000) await setState({ stage: -1, error: "the last run stopped half way" }); // a restart mid-run
    if (refreshDue(await registryState(), now)) await runRefresh(prospects);
  } catch (e) { console.error("[orbit] registry refresh failed:", e instanceof Error ? e.message : e); }
}

/** New leads are matched against the index already on disk (no download). Quietly nothing before the first refresh. Never throws. */
export async function matchIfIndexed(leads: Lead[]) {
  try {
    if (!leads.length || running() || !(await access(F.index()).then(() => true, () => false))) return;
    const res = await matchLeads(leads);
    const want = new Map([...res].flatMap(([id, m]) => (isLinked(m) && m.state !== "gone" && m.info.formShort !== "FIE" ? [[id, m.info.code] as const] : [])));
    if (want.size) await lookUpBoards(want, "add");
  } catch (e) { console.error("[orbit] registry match failed:", e instanceof Error ? e.message : e); }
}
