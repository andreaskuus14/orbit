// DEEP RESEARCH runner (rules + card: research-pure.ts). One research at a time, in this server process. Opus plans, searches
// run two at a time through Claude's web search (read-only), the pages are opened by the web ladder (fetch → Scrapling → browser:
// no cookies, no logins, robots.txt), Haiku takes notes, Opus writes, the local fact check marks unbacked sentences, and the
// report goes to VAULT (TIME MACHINE Undo). Every step checks Stop-all and the usage pacer first. Shown on the shared card.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, recordUsage, FAST_MODEL, MODEL, SMART_MODEL, type ClaudeResult } from "./claude";
import { WEB_SEARCH_SYSTEM } from "./core-web-pure";
import { stopAllOn } from "./stop-all";
import { usageHardHold, usageHold } from "./usage-meter";
import { addSources, applyCheck, assembleCitations, budgetFrom, linksIn, mayStart, msLeft, newState, nextToRead, noteBatches, notesPrompt, pace, parseNotes, parsePlan,
  patchSrc, queryOrder, readSources, reportClaims, reportDoc, reportName, researchCard, shrink, statusText, toPhase, writePrompt, NOTES_SYSTEM, PLAN_SYSTEM, WRITE_SYSTEM,
  type Phase, type RState } from "./research-pure";
import type { Lang } from "./i18n-core-pure";
import type { Progress } from "./progress-pure";

type Job = { s: RState; ctl: AbortController; doing?: string };
const G = globalThis as unknown as { __orbitResearch?: { jobs: Job[] } };
const st = (G.__orbitResearch ??= { jobs: [] });
const KEEP = 8;

const live = () => st.jobs.find((j) => !["done", "stopped", "failed"].includes(j.s.phase));
const set = (j: Job, s: RState) => { j.s = s; };
const to = (j: Job, p: Phase, why?: string) => set(j, toPhase(j.s, p, Date.now(), why));

/** Cards for home / CORE (newest first; finished ones for 24 h). */
export function researchCards(nowMs = Date.now()): Progress[] {
  return st.jobs.filter((j) => nowMs - j.s.at < 86_400_000).map((j) => researchCard(j.s, nowMs, j.doing));
}
export const researchStatus = (nowMs = Date.now()) => (st.jobs.length ? st.jobs.slice(0, 3).map((j) => statusText(j.s, nowMs)).join("\n") : "No deep research has run yet.");
/** Stop one research (or the running one); it saves what it has when something was read. */
export function stopResearch(id?: string): boolean {
  const j = id ? st.jobs.find((x) => x.s.id === id) : live();
  if (!j || ["done", "stopped", "failed"].includes(j.s.phase)) return false;
  j.ctl.abort();
  return true;
}
export const abortResearch = () => { const j = live(); if (j) j.ctl.abort(); return !!j; };

/** Start a research run in the background; returns its id at once (or an error). */
export function startResearch(sb: SupabaseClient, userId: string, question: string, lang: Lang, input: { pages?: unknown; minutes?: unknown }): { id: string } | { error: string } {
  if (stopAllOn()) return { error: "ORBIT is paused (Stop-all is on)" };
  const hard = usageHardHold();
  if (hard) return { error: `Claude's usage limit is reached (${hard}); try again later` };
  const busy = live();
  if (busy) return { error: `a deep research is already running ("${busy.s.question.slice(0, 80)}"); wait for it or stop it with research_stop` };
  const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const j: Job = { s: newState(id, question, lang, budgetFrom(input), Date.now()), ctl: new AbortController() };
  st.jobs.unshift(j);
  st.jobs.splice(KEEP);
  void run(sb, userId, j).catch((e) => { console.error("[orbit] deep research failed:", e); to(j, "failed", e instanceof Error ? e.message.slice(0, 200) : String(e)); });
  return { id };
}

class Halt extends Error {}
/** Before each step: Stop-all / Stop → halt; the hard usage limit → halt; the soft budget → shrink. */
function gate(j: Job) {
  if (j.ctl.signal.aborted) throw new Halt(stopAllOn() ? "Stop-all is on" : "Stopped");
  const p = pace({ stopAll: stopAllOn(), hard: usageHardHold(), soft: usageHold() });
  if (p.kind === "stop") throw new Halt(p.why);
  if (p.kind === "shrink" && !j.s.shrunk) set(j, { ...shrink(j.s), note: "Made smaller to stay inside the usage budget" });
}
async function ask(sb: SupabaseClient, userId: string, j: Job, prompt: string, system: string, o: { model: string; purpose: string; timeoutMs: number; web?: "search" }): Promise<ClaudeResult> {
  gate(j);
  set(j, { ...j.s, used: { ...j.s.used, calls: j.s.used.calls + 1 } });
  const r = await askClaude(prompt, system, { lane: "foreground", signal: j.ctl.signal, model: o.model, purpose: o.purpose, timeoutMs: o.timeoutMs, ...(o.web && { web: o.web }) });
  void recordUsage(sb, userId, o.purpose, r, o.model).catch(() => {});
  return r;
}
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { for (let x = q.shift(); x !== undefined; x = q.shift()) await fn(x); }));
}

async function run(sb: SupabaseClient, userId: string, j: Job) {
  const { ladderRead, newLookup } = await import("./web-ladder");
  const { BULK_BUDGET } = await import("./web-ladder-pure");
  try {
    // 1. plan (Opus)
    const planR = await ask(sb, userId, j, `RESEARCH QUESTION: ${j.s.question}`, PLAN_SYSTEM, { model: SMART_MODEL, purpose: "research.plan", timeoutMs: 120_000 });
    const plan = parsePlan(planR.text, j.s.question) ?? { title: j.s.question.slice(0, 100), subs: [{ q: j.s.question, queries: [j.s.question.slice(0, 120)] }], outline: [] };
    set(j, { ...j.s, plan });

    // 2. searches, two at a time
    to(j, "search");
    const queries = queryOrder(plan);
    await pool(queries, 2, async (q) => {
      if (!mayStart(j.s, "search", Date.now())) return;
      gate(j);
      set(j, { ...j.s, used: { ...j.s.used, searches: j.s.used.searches + 1 } });
      j.doing = q;
      const r = await ask(sb, userId, j, `Search: ${q}`, WEB_SEARCH_SYSTEM, { model: MODEL, purpose: "research.search", timeoutMs: Math.min(150_000, Math.max(30_000, msLeft(j.s, Date.now()) - 120_000)), web: "search" }).catch((e) => { if (e instanceof Halt || j.ctl.signal.aborted) throw e; return null; });
      if (r?.text) set(j, addSources(j.s, linksIn(r.text)));
    });
    j.doing = undefined;
    if (!j.s.sources.length) throw new Error("the searches found no pages to read");

    // 3. read pages through the ladder (one shared lookup = one page cap and one time budget), four at a time
    to(j, "read");
    const lookup = newLookup({ ...BULK_BUDGET, maxPages: j.s.budget.pages, totalMs: Math.max(30_000, msLeft(j.s, Date.now()) - 180_000) });
    for (let round = 0; round < 4; round++) {
      const batch = nextToRead(j.s, j.s.budget.pages);
      if (!batch.length) break;
      await pool(batch, 4, async (src) => {
        if (!mayStart(j.s, "page", Date.now())) return;
        gate(j);
        set(j, patchSrc(j.s, src.id, { status: "reading" }));
        const r = await ladderRead(src.url, { maxChars: 9000, lookup }).catch(() => null);
        const ok = !!r?.page && r.page.text.trim().length >= 300;
        set(j, { ...patchSrc(j.s, src.id, ok ? { status: "read", text: r!.page!.text, title: r!.page!.title || src.title, url: src.url, via: r!.record.rung ?? undefined } : { status: "failed", why: r?.record.tried.at(-1)?.reason ?? "error" }),
          used: { ...j.s.used, pages: j.s.used.pages + (ok ? 1 : 0) } });
      });
      if (readSources(j.s).length >= j.s.budget.pages || msLeft(j.s, Date.now()) < 200_000) break;
    }
    if (!readSources(j.s).length) throw new Error("none of the pages could be read");

    // 4. notes (Haiku, three pages per call)
    to(j, "notes");
    await pool(noteBatches(readSources(j.s)), 2, async (b) => {
      if (!mayStart(j.s, "call", Date.now()) || msLeft(j.s, Date.now()) < 120_000) return;
      const r = await ask(sb, userId, j, notesPrompt(j.s.question, b), NOTES_SYSTEM, { model: FAST_MODEL, purpose: "research.notes", timeoutMs: 120_000 }).catch((e) => { if (e instanceof Halt || j.ctl.signal.aborted) throw e; return null; });
      if (!r?.text) return;
      for (const [id, notes] of parseNotes(r.text, b.map((x) => x.id))) set(j, patchSrc(j.s, id, { notes }));
    });
    // a page without notes (the notes call failed or ran out of time) still counts with its opening text
    for (const x of readSources(j.s)) if (!x.notes && x.text) set(j, patchSrc(j.s, x.id, { notes: x.text.slice(0, 1200) }));
    await finish(sb, userId, j, false);
  } catch (e) {
    const why = e instanceof Halt ? e.message : j.ctl.signal.aborted ? (stopAllOn() ? "Stop-all is on" : "Stopped") : null;
    if (why === null) throw e;
    // Stopped: with notes already taken, Stop-all ends it at once; a plain Stop still writes up what was read.
    if (!stopAllOn() && readSources(j.s).some((x) => x.notes) && !j.s.report) { j.ctl = new AbortController(); await finish(sb, userId, j, true, why).catch(() => to(j, "stopped", why)); }
    else to(j, "stopped", why);
  } finally {
    j.doing = undefined;
    for (const x of j.s.sources) delete x.text; // page text leaves memory once the job is over
  }
}

/** write → check → save. early: stopped by him; the report says it is partial. */
async function finish(sb: SupabaseClient, userId: string, j: Job, early: boolean, why?: string) {
  to(j, "write");
  const w = await ask(sb, userId, j, writePrompt(j.s), WRITE_SYSTEM, { model: SMART_MODEL, purpose: "research.write", timeoutMs: 300_000 });
  const heading = j.s.lang === "et" ? "Allikad" : "Sources";
  const asm = assembleCitations(w.text, readSources(j.s), heading);
  let body = asm.text;
  to(j, "check");
  const claims = reportClaims(body, asm.cited);
  const sources = new Map(readSources(j.s).map((x) => [x.url, { id: x.url, text: x.text ?? x.notes ?? "" }]));
  const fc = claims.length ? await (await import("./factcheck")).checkClaimsLocal(claims, sources, 45_000).catch(() => null) : null;
  if (fc) { const a = applyCheck(body, claims, fc.v, j.s.lang); body = a.text; set(j, { ...j.s, check: { backed: a.backed, flagged: a.flagged, unchecked: a.unchecked } }); }
  if (asm.dropped) set(j, { ...j.s, note: [j.s.note, `${asm.dropped} citation${asm.dropped === 1 ? "" : "s"} to pages it didn't read removed`].filter(Boolean).join(". ") });
  if (early) set(j, { ...j.s, note: [j.s.note, `Stopped early (${why}): partial report`].filter(Boolean).join(". ") });
  to(j, "save");
  const now = new Date().toISOString();
  const doc = reportDoc(j.s, body, now);
  const { saveUpload } = await import("./vault");
  const saved = await saveUpload(new File([doc], reportName(j.s, now), { type: "text/markdown" }), { made: "Deep research report" });
  set(j, { ...j.s, report: body, savedAs: saved });
  to(j, early ? "stopped" : "done", early ? why : undefined);
  const { logActivity } = await import("./activity");
  logActivity({ area: "core", title: `Deep research saved: ${saved}`, detail: `${readSources(j.s).length} pages read` });
}

/** CORE tools deep_research / research_status / research_stop. */
export async function runResearchTool(tool: string, input: Record<string, unknown>, c: { sb: SupabaseClient; userId: string; lang?: Lang }): Promise<string> {
  if (tool === "research_status") return researchStatus();
  if (tool === "research_stop") return stopResearch(typeof input.id === "string" ? input.id : undefined) ? "Done: the research stops now; what it already read is written up and saved." : "No deep research is running.";
  const { questionOf } = await import("./research-pure");
  const q = questionOf(input.question);
  if ("error" in q) return `Error: ${q.error}`;
  const r = startResearch(c.sb, c.userId, q.q, c.lang ?? "en", input);
  if ("error" in r) return `Error: ${r.error}`;
  const b = budgetFrom(input);
  return `Started deep research ${r.id}: up to ${b.pages} pages in about ${b.minutes} minutes. It runs in the background and shows on the "Working on it" card; the cited report is saved to VAULT when it's done. Tell him that in one or two sentences and don't wait for it.`;
}

