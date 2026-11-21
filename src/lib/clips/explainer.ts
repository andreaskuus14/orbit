// YouTube autopilot (no vidIQ): research a niche from public data → the top outliers and why they worked → one idea card per topic
// with Claude's script + storyboard + title/thumbnail options → style frames → (his click) → 5-8 s motion test → (his click) → the
// hand-off package for the Remotion/Kokoro explainer pipeline. Gates: explainer-pure.ts. Renders: STUDIO's local stickman scene
// renderer (scene-render.ts), free and on this PC. State: <studio>/yt-autopilot.json. Nothing here uploads or posts anything.
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { askClaude, SMART_MODEL } from "../claude";
import { logActivity } from "../activity";
import { stopAllOn } from "../stop-all";
import { ffmpegPath, readState, saveState, studioRoot } from "./factory";
import { jsonObject } from "./story-pure";
import { buildFilm } from "./scene-render";
import { manifestProblems, totalFrames, FPS } from "./scene-manifest-pure";
import { researchInput } from "../yt-research-pure";
import { runResearch, type Report } from "../yt-research";
import {
  DRAFT_SYSTEM, actionProblem, approve, draftPrompt, handoffPackage, ideaProgress, motionTestManifest, resetFromScript, styleFramesManifest, validDraft,
  type Action, type Idea, type Progress,
} from "./explainer-pure";

type State = { v: 1; ideas: Idea[]; report: Report | null; research: { running: boolean; step: string | null; now: string | null; error: string | null; at: string | null } };
const root = () => path.join(studioRoot(), "yt-autopilot");
const file = () => path.join(root(), "state.json");
const empty = (): State => ({ v: 1, ideas: [], report: null, research: { running: false, step: null, now: null, error: null, at: null } });
const G = globalThis as unknown as { __orbitYtAuto?: { state?: State; lock: Promise<unknown>; ctrl?: AbortController } };
const S = (G.__orbitYtAuto ??= { lock: Promise.resolve() });

async function load(): Promise<State> {
  if (S.state) return S.state;
  const s = await readState<State>(root(), "state", (x) => (x && typeof x === "object" && Array.isArray((x as State).ideas) ? "" : "not a state file"));
  S.state = s ?? empty();
  if (S.state.research.running) S.state.research = { ...S.state.research, running: false, error: "ORBIT restarted during the research; start it again" };
  for (const i of S.state.ideas) if (i.working) { i.working = null; i.failed = "ORBIT restarted while this was running"; }
  return S.state;
}
/** Serialized read-modify-write. */
function edit<T>(fn: (s: State) => T | Promise<T>): Promise<T> {
  const p = S.lock.then(async () => { const s = await load(); const r = await fn(s); await saveState("yt-autopilot", file(), s); return r; });
  S.lock = p.catch(() => {});
  return p;
}
const now = () => new Date().toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type View = { cards: Progress[]; ideas: Idea[]; report: Report | null; research: State["research"]; researchCard: Progress | null };
const RESEARCH_STEPS = ["Searching YouTube", "Reading channels", "Finding outliers", "Working out why", "Cross-checking", "Writing ideas"];
export async function view(): Promise<View> {
  const s = await load(), r = s.research;
  const cur = r.step ? Math.max(0, RESEARCH_STEPS.indexOf(r.step)) : RESEARCH_STEPS.length;
  const researchCard: Progress | null = r.running || r.error ? {
    id: "yt-research", title: `Finding what works in "${s.report?.niche ?? "your niche"}"`, phase: r.error ? "failed" : "working",
    steps: RESEARCH_STEPS.map((label, k) => ({ label, state: k < cur ? "done" : k === cur ? (r.error ? "failed" : "now") : "next" })),
    now: r.running ? r.now : null, leftMin: r.running ? Math.max(1, 8 - cur) : null, result: r.error ? { text: r.error } : null,
    action: r.error ? { kind: "retry", label: "Try again", open: "#o=studio&k=ideas" } : null, at: r.at ?? now(),
  } : null;
  const live = s.ideas.filter((i) => !i.dismissed);
  return { cards: live.map(ideaProgress), ideas: live, report: s.report, research: r, researchCard };
}

/* ---------------- research → idea cards ---------------- */

export async function startResearch(raw: unknown): Promise<{ started: boolean; error?: string }> {
  const inp = researchInput(raw);
  if (typeof inp === "string") return { started: false, error: inp };
  if (stopAllOn()) return { started: false, error: "Stop-all is on" };
  const s = await load();
  if (s.research.running) return { started: false, error: "Already researching" };
  await edit((st) => { st.research = { running: true, step: RESEARCH_STEPS[0], now: "Starting", error: null, at: now() }; st.report = st.report ? { ...st.report, niche: inp.niche } : null; });
  const ctrl = (S.ctrl = new AbortController());
  void (async () => {
    try {
      const report = await runResearch(inp, (step, n) => { void edit((st) => { st.research = { ...st.research, step, now: n, at: now() }; }); }, ctrl.signal);
      await edit((st) => { st.report = report; st.research = { ...st.research, step: "Writing ideas", now: "Writing scripts for the best topics", at: now() }; });
      await draftIdeas(report, ctrl.signal);
      await edit((st) => { st.research = { running: false, step: null, now: null, error: null, at: now() }; });
      logActivity({ area: "autopilot", title: `YouTube autopilot: researched "${inp.niche}" (${report.outliers.length} outliers)`, link: { panel: "studio" } });
    } catch (e) {
      await edit((st) => { st.research = { ...st.research, running: false, error: msg(e), at: now() }; });
    }
  })();
  return { started: true };
}

/** One idea per top topic cluster (max 3), each drafted by Claude from the "why" of its outliers. */
async function draftIdeas(report: Report, signal?: AbortSignal) {
  const groups = report.clusters.slice(0, 3).map((c) => ({ c, vids: report.outliers.filter((o) => o.cluster === c.label) })).filter((g) => g.vids.length);
  if (!groups.length && report.outliers.length) groups.push({ c: { label: report.outliers[0].cluster || report.niche, videos: 1, weight: 0, trend: "unknown", reddit: null, titles: [] }, vids: report.outliers.slice(0, 1) });
  for (const g of groups) {
    const lead = g.vids[0], t = now();
    const idea: Idea = {
      id: `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, niche: report.niche, topic: "", angle: "", why: lead.why, createdAt: t, updatedAt: t,
      sources: g.vids.map((v) => ({ id: v.id, title: v.title, channel: v.channel, projected: v.projected })), working: "Writing the script and storyboard", failed: null,
      script: [], storyboard: [], titles: [], thumbs: [], abNote: "", styleFrames: null, styleApprovedAt: null, motionTest: null, motionApprovedAt: null, handoff: null,
    };
    await edit((s) => { s.ideas.unshift(idea); s.ideas = s.ideas.slice(0, 30); });
    await draftOne(idea.id, `${g.c.label} (${report.niche})`, report.lifts.slice(0, 3).map((l) => `title: ${l.feature}`), signal);
  }
}

async function draftOne(id: string, topicHint: string, patterns: string[], signal?: AbortSignal) {
  const s = await load(), i = s.ideas.find((x) => x.id === id);
  if (!i) return;
  const avoid = [...i.sources.map((x) => x.title), ...(s.report?.outliers.map((o) => o.title) ?? [])];
  try {
    const r = await askClaude(draftPrompt({ niche: i.niche, topic: topicHint, why: i.why, patterns, avoidTitles: avoid }), DRAFT_SYSTEM, { model: SMART_MODEL, signal, purpose: "yt-autopilot draft", timeoutMs: 240_000 });
    const d = validDraft(jsonObject(r.text), avoid);
    if (typeof d === "string") throw new Error(`The draft didn't pass the checks: ${d}`);
    await edit((st) => { const x = st.ideas.find((y) => y.id === id); if (x) Object.assign(x, d, { working: null, failed: null, updatedAt: now() }); });
    await makeStyleFrames(id); // local and free: so the card can ask him to look straight away
  } catch (e) {
    await edit((st) => { const x = st.ideas.find((y) => y.id === id); if (x) Object.assign(x, { working: null, failed: msg(e), updatedAt: now() }); });
  }
}

/* ---------------- renders ---------------- */

const run = (bin: string, args: string[]) => new Promise<void>((res, rej) => execFile(bin, args, { windowsHide: true, timeout: 60_000 }, (e) => (e ? rej(e) : res())));

async function setWorking(id: string, working: string | null, patch: Partial<Idea> = {}) {
  await edit((st) => { const x = st.ideas.find((y) => y.id === id); if (x) Object.assign(x, { working, updatedAt: now() }, patch); });
}

async function makeStyleFrames(id: string) {
  const i = (await load()).ideas.find((x) => x.id === id);
  if (!i) return;
  const ff = await ffmpegPath();
  if (!ff) { await setWorking(id, null, { failed: "ffmpeg is missing" }); return; }
  const m = styleFramesManifest(i), bad = manifestProblems(m);
  if (bad.length) { await setWorking(id, null, { failed: `Style frames: ${bad[0]}` }); return; }
  await setWorking(id, "Drawing the style frames", { failed: null });
  try {
    const dir = path.join(root(), id);
    const film = await buildFilm(m, "vertical", { ffmpeg: ff, cache: path.join(root(), "cache"), out: path.join(dir, "style"), scale: 0.5 });
    const files: string[] = [];
    for (let k = 0; k < m.scenes.length; k++) {
      const f = path.join(dir, `style-${k + 1}.png`);
      await run(ff, ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(k + 0.6), "-i", film.final.file, "-frames:v", "1", f]);
      files.push(f);
    }
    await setWorking(id, null, { styleFrames: { files, at: now() }, styleApprovedAt: null });
  } catch (e) { await setWorking(id, null, { failed: `Style frames didn't render: ${msg(e)}` }); }
}

async function makeMotionTest(id: string) {
  const i = (await load()).ideas.find((x) => x.id === id);
  if (!i) return;
  const ff = await ffmpegPath();
  if (!ff) { await setWorking(id, null, { failed: "ffmpeg is missing" }); return; }
  const m = motionTestManifest(i), bad = manifestProblems(m);
  if (bad.length) { await setWorking(id, null, { failed: `Motion test: ${bad[0]}` }); return; }
  await setWorking(id, "Animating the 5-8 s motion test", { failed: null });
  try {
    const film = await buildFilm(m, "vertical", { ffmpeg: ff, cache: path.join(root(), "cache"), out: path.join(root(), id, "motion"), scale: 0.5 });
    await setWorking(id, null, { motionTest: { file: film.final.file, sec: Math.round(totalFrames(m) / FPS), at: now() }, motionApprovedAt: null });
  } catch (e) { await setWorking(id, null, { failed: `The motion test didn't render: ${msg(e)}` }); }
}

/* ---------------- owner actions ---------------- */

/** Every button on a card ends here; the gates in explainer-pure.ts decide. Approvals are only ever his click (the route requires the owner). */
export async function act(id: unknown, action: unknown): Promise<{ ok: true } | { error: string; status: number }> {
  if (typeof id !== "string" || !/^[a-z0-9]{6,12}-[a-f0-9]{6}$/.test(id)) return { error: "unknown idea", status: 404 };
  const actions: (Action | "dismiss" | "retry")[] = ["make-style-frames", "approve-style", "make-motion-test", "approve-motion", "handoff", "redo-script", "dismiss", "retry"];
  if (!actions.includes(action as Action)) return { error: "unknown action", status: 400 };
  if (stopAllOn() && action !== "dismiss") return { error: "Stop-all is on", status: 409 };
  const i = (await load()).ideas.find((x) => x.id === id);
  if (!i) return { error: "unknown idea", status: 404 };
  if (action === "dismiss") { await edit((s) => { const x = s.ideas.find((y) => y.id === id); if (x) x.dismissed = true; }); return { ok: true }; }
  if (action === "retry") {
    if (i.working) return { error: `Still working: ${i.working}`, status: 409 };
    await setWorking(id, null, { failed: null });
    const next = !i.script.length ? "redo-script" : !i.styleFrames ? "make-style-frames" : i.styleApprovedAt && !i.motionTest ? "make-motion-test" : null;
    if (next) return act(id, next);
    return { ok: true };
  }
  const problem = actionProblem(i, action as Action);
  if (problem) return { error: problem, status: 409 };
  switch (action as Action) {
    case "approve-style":
      await edit((s) => { s.ideas = s.ideas.map((x) => (x.id === id ? approve(x, "approve-style", now()) : x)); });
      logActivity({ area: "autopilot", title: `YouTube autopilot: you approved the style frames for "${i.topic}"`, link: { panel: "studio" } });
      void makeMotionTest(id); // next step of his rule, local and free
      return { ok: true };
    case "approve-motion":
      await edit((s) => { s.ideas = s.ideas.map((x) => (x.id === id ? approve(x, "approve-motion", now()) : x)); });
      logActivity({ area: "autopilot", title: `YouTube autopilot: you approved the motion test for "${i.topic}"`, link: { panel: "studio" } });
      return { ok: true };
    case "make-style-frames": void makeStyleFrames(id); return { ok: true };
    case "make-motion-test": void makeMotionTest(id); return { ok: true };
    case "redo-script":
      await edit((s) => { s.ideas = s.ideas.map((x) => (x.id === id ? { ...resetFromScript(x, now()), working: "Writing the script and storyboard" } : x)); });
      void draftOne(id, i.topic || i.niche, []);
      return { ok: true };
    case "handoff": {
      const dir = path.join(root(), id), f = path.join(dir, "handoff.json");
      await mkdir(dir, { recursive: true });
      await writeFile(f, JSON.stringify(handoffPackage(i), null, 2));
      await edit((s) => { const x = s.ideas.find((y) => y.id === id); if (x) Object.assign(x, { handoff: { file: f, at: now() }, updatedAt: now() }); });
      logActivity({ area: "autopilot", title: `YouTube autopilot: "${i.topic}" handed to the explainer pipeline (nothing uploaded)`, link: { panel: "studio" } });
      return { ok: true };
    }
  }
}

/** A file of an idea (style frame PNG or the motion test MP4) for the card's preview; only paths the state itself recorded. */
export async function ideaFile(id: string, which: string): Promise<string | null> {
  const i = (await load()).ideas.find((x) => x.id === id);
  if (!i) return null;
  const m = /^style-([1-3])$/.exec(which);
  if (m) return i.styleFrames?.files[Number(m[1]) - 1] ?? null;
  return which === "motion" ? i.motionTest?.file ?? null : null;
}
