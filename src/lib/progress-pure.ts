// "Working on it": one progress model for every kind of work (owner 21 Nov: "I have a problem → ORBIT fixes it → I can see the
// progress"). Every request becomes one Progress: plain steps (✓ done, ● now, ○ next), "about X min left", one live line of what
// it's doing, the result at the end, and at most one button when it needs him. Builders turn the existing sources (agent tasks
// with their trace, plan jobs, missions, staged pipelines such as clip / 3D / video renders) into it. The card is
// components/ProgressCard.tsx; the same card is used on home, in Needs you, on the phone and in every planet. Pure; tests in
// tests/progress.test.ts. An action never approves by itself: it opens where the exact item and its own Approve live (AGENTS.md rule 6).
import type { Lang } from "./i18n-pure.ts";
import { opsStatus } from "./ops-status-pure.ts";

export type StepState = "done" | "now" | "next" | "failed";
export type ProgressStep = { label: string; state: StepState };
/** working: moving now · waiting: queued or held (Stop-all) · needs: waits for his click · done · failed. */
export type ProgressPhase = "waiting" | "working" | "needs" | "done" | "failed";
/** open: a deep-link hash ("#o=operations&k=task&id=…") or an http(s) / workspace href. */
export type ProgressAction = { kind: "approve" | "pick" | "retry" | "open" | "undo"; label: string; open: string };
export type Progress = {
  id: string; title: string; phase: ProgressPhase; steps: ProgressStep[];
  now: string | null;      // one line: what it is doing right now (null when not working)
  leftMin: number | null;  // rough minutes left; null = unknown (never invented)
  result: { text: string; open?: string } | null;
  action: ProgressAction | null;
  at: string;              // ISO time it last moved (sorting)
};

const W = {
  en: { approve: "Approve", pick: "Pick one", retry: "Try again", open: "Open", see: "See result", start: "Getting started", finish: "Finishing up", plan: "Planning",
    left: (m: number) => (m <= 1 ? "almost done" : m < 120 ? `about ${m} min left` : m < 2880 ? `about ${Math.round(m / 60)} h left` : `about ${Math.round(m / 1440)} days left`), failed: "Didn't work", waiting: "Waiting to start", held: "Paused by Stop-all", needs: "Needs you",
    line: (w: number, n: number, d: number) => [w && `Working on ${w} thing${w === 1 ? "" : "s"}`, n && `${n} need${n === 1 ? "s" : ""} you`, d && `${d} done today`].filter(Boolean).join(" · ") || "Nothing running. Tell ORBIT what you need." },
  et: { approve: "Kinnita", pick: "Vali üks", retry: "Proovi uuesti", open: "Ava", see: "Vaata tulemust", start: "Alustan", finish: "Lõpetan", plan: "Planeerin",
    left: (m: number) => (m <= 1 ? "kohe valmis" : m < 120 ? `umbes ${m} min veel` : m < 2880 ? `umbes ${Math.round(m / 60)} h veel` : `umbes ${Math.round(m / 1440)} päeva veel`), failed: "Ei õnnestunud", waiting: "Ootab algust", held: "Peatatud (Peata kõik)", needs: "Vajab sind",
    line: (w: number, n: number, d: number) => [w && `Töös ${w}`, n && `${n} vajab sind`, d && `täna valmis ${d}`].filter(Boolean).join(" · ") || "Midagi ei käi. Ütle ORBITile, mida vajad." },
} as const;
export const words = (lang: Lang) => W[lang];

// Tool / trace step names → plain words. Unknown names become "Working" rather than showing an internal name.
const PLAIN: [RegExp, { en: string; et: string }][] = [
  [/^(web_search|search_web|research)/, { en: "Searching the web", et: "Otsin veebist" }],
  [/^(fetch_url|read_more|read_news|browse)/, { en: "Reading pages", et: "Loen lehti" }],
  [/^(search_memory|recall|memory)/, { en: "Checking what I know", et: "Vaatan, mida tean" }],
  [/^(save_memory|remember)/, { en: "Saving a note", et: "Salvestan märkme" }],
  [/^(ws_write|ws_create|write_file|edit_file)/, { en: "Writing files", et: "Kirjutan faile" }],
  [/^(ws_fetch_image|ws_inspire_image|ws_picture|image|picture)/, { en: "Finding pictures", et: "Otsin pilte" }],
  [/^(ask_agent|delegate|start_mission)/, { en: "Handing part of it to a helper", et: "Annan osa abilisele" }],
  [/^(check|verify|test|playtest|headless)/, { en: "Checking the result", et: "Kontrollin tulemust" }],
  [/^(render|clip|export|encode)/, { en: "Making the video", et: "Teen videot" }],
  [/^(draft|email|pitch)/, { en: "Writing a draft", et: "Kirjutan mustandit" }],
  [/^(think|sdk|route|plan)/, { en: "Thinking it through", et: "Mõtlen läbi" }],
];
const SKIP = /^(fallback|route|sdk)$/;
export function plainStep(name: string, lang: Lang): string {
  const n = name.trim().toLowerCase();
  for (const [re, w] of PLAIN) if (re.test(n)) return w[lang];
  return lang === "et" ? "Töötan" : "Working";
}

/** Labels + the index of the current one → ✓/●/○ steps. current ≥ labels.length = all done; failed marks the current step. */
export function stepsFrom(labels: string[], current: number, failed = false): ProgressStep[] {
  return labels.map((label, i) => ({ label, state: i < current ? "done" : i === current ? (failed ? "failed" : "now") : "next" }));
}

/** Minutes left from how long it has run and how long such work usually takes; null when there's no basis. Never below 1 while running. */
export function minutesLeft(startedAt: string | null | undefined, nowMs: number, typicalMs: number | null | undefined, frac?: number): number | null {
  const start = Date.parse(startedAt ?? "");
  if (typicalMs && typicalMs > 0 && Number.isFinite(start)) return Math.max(1, Math.ceil((typicalMs - (nowMs - start)) / 60_000));
  if (typicalMs && typicalMs > 0 && frac !== undefined) return Math.max(1, Math.ceil((typicalMs * (1 - Math.min(1, Math.max(0, frac)))) / 60_000 - 1e-9));
  return null;
}
export const leftText = (m: number | null, lang: Lang) => (m === null ? "" : W[lang].left(m));

const taskLink = (id: string) => `#o=operations&k=task&id=${encodeURIComponent(id)}`;
const firstLine = (s: string | null | undefined, max = 160) => (s ?? "").replace(/[#*_`>]/g, "").split(/\n+/).map((l) => l.trim()).find(Boolean)?.slice(0, max) ?? "";

export type TaskLike = { id: string; title: string; status: string; result?: string | null; error?: string | null; created_at: string; started_at?: string | null; finished_at?: string | null;
  trace?: unknown; pending?: unknown };

/** An agent task (tasks row) → Progress. Steps are the distinct plain labels of its trace, then "Finishing up" while it runs. */
export function fromTask(t: TaskLike, lang: Lang, o: { nowMs: number; typicalMs?: number | null; stopAll?: boolean }): Progress {
  const w = W[lang], st = opsStatus(t.status, { stopAll: o.stopAll, pending: t.pending });
  const trace = Array.isArray(t.trace) ? (t.trace as { step?: unknown; ok?: unknown }[]) : [];
  const labels: string[] = [];
  for (const s of trace) { const n = typeof s?.step === "string" ? s.step : ""; if (!n || SKIP.test(n)) continue; const l = plainStep(n, lang); if (labels.at(-1) !== l && !labels.includes(l)) labels.push(l); }
  let steps: ProgressStep[];
  if (st === "complete") steps = stepsFrom(labels.length ? labels : [w.start], Infinity);
  else if (st === "failed" || st === "cancelled") steps = stepsFrom(labels.length ? labels : [w.start], Math.max(0, labels.length - 1), true);
  else if (st === "queued" || (st === "blocked" && !labels.length)) steps = stepsFrom([w.start, w.finish], 0).map((s) => ({ ...s, state: "next" as const }));
  else steps = stepsFrom([...(labels.length ? labels : [w.plan]), w.finish], labels.length ? labels.length - 1 : 0);
  const phase: ProgressPhase = st === "complete" ? "done" : st === "failed" || st === "cancelled" ? "failed" : st === "waiting" ? "needs" : st === "queued" || st === "blocked" ? "waiting" : "working";
  const nowLine = phase === "working" ? steps.find((s) => s.state === "now")?.label ?? null : phase === "waiting" ? (o.stopAll ? w.held : w.waiting) : null;
  const open = taskLink(t.id);
  const action: ProgressAction | null = phase === "needs" ? { kind: "approve", label: w.approve, open }
    : phase === "failed" ? { kind: "retry", label: w.retry, open } : null;
  const result = phase === "done" && firstLine(t.result) ? { text: firstLine(t.result), open } : phase === "failed" ? { text: firstLine(t.error) || w.failed, open } : null;
  return { id: t.id, title: t.title, phase, steps, now: nowLine, leftMin: phase === "working" ? minutesLeft(t.started_at, o.nowMs, o.typicalMs) : null,
    result, action, at: t.finished_at || t.started_at || t.created_at };
}

/** A staged pipeline (clip render, 3D model, video, site build…) → Progress. The planets build these from their own job state. */
export function fromStages(p: { id: string; title: string; stages: string[]; current: number; failed?: boolean; error?: string; now?: string | null;
  startedAt?: string | null; typicalMs?: number | null; result?: { text: string; open?: string } | null; needs?: ProgressAction | null; at: string }, lang: Lang, nowMs: number): Progress {
  const done = p.current >= p.stages.length;
  const phase: ProgressPhase = p.failed ? "failed" : p.needs ? "needs" : done ? "done" : p.current < 0 ? "waiting" : "working";
  const steps = p.current < 0 ? stepsFrom(p.stages, -1).map((s) => ({ ...s, state: "next" as const })) : stepsFrom(p.stages, p.current, p.failed);
  const frac = p.stages.length ? Math.max(0, p.current) / p.stages.length : 0;
  return { id: p.id, title: p.title, phase, steps, now: phase === "working" ? p.now ?? p.stages[p.current] ?? null : phase === "waiting" ? W[lang].waiting : null,
    leftMin: phase === "working" ? minutesLeft(p.startedAt, nowMs, p.typicalMs, p.startedAt ? undefined : frac) : null,
    result: p.failed ? { text: p.error || W[lang].failed } : p.result ?? null,
    action: p.needs ?? (p.failed ? { kind: "retry", label: W[lang].retry, open: p.result?.open ?? "" } : null), at: p.at };
}

/** A plan job (plan-jobs-pure PlanJob) → Progress. */
export function fromPlanJob(j: { id: string; title: string; status: string; updatedAt: string; steps: { text: string; status: string; task?: string }[] }, lang: Lang): Progress {
  const i = j.steps.findIndex((s) => s.status !== "done");
  const failed = i >= 0 && j.steps[i].status === "failed";
  const cur = i < 0 ? j.steps.length : i;
  const steps = stepsFrom(j.steps.map((s) => s.text), cur, failed).map((s, k) => (k === cur && j.steps[k]?.status === "todo" ? { ...s, state: "next" as const } : s));
  const phase: ProgressPhase = i < 0 || j.status === "done" ? "done" : failed ? "failed" : j.status === "paused" ? "waiting" : steps.some((s) => s.state === "now") ? "working" : "waiting";
  const open = `#o=operations&v=plans&k=plan&id=${encodeURIComponent(j.id)}`;
  return { id: `plan:${j.id}`, title: j.title, phase, steps, now: phase === "working" ? j.steps[cur]?.text ?? null : phase === "waiting" ? W[lang].waiting : null, leftMin: null,
    result: null, action: failed ? { kind: "retry", label: W[lang].retry, open } : null, at: j.updatedAt };
}

const ORDER: Record<ProgressPhase, number> = { needs: 0, working: 1, waiting: 2, failed: 3, done: 4 };
/** Needs-you first, then running, waiting, failed, done; newest first inside each. */
export const sortProgress = (xs: Progress[]) => [...xs].sort((a, b) => ORDER[a.phase] - ORDER[b.phase] || Date.parse(b.at) - Date.parse(a.at));

/** The home status line: "Working on 2 things · 1 needs you · 3 done today" (Tallinn day is not needed here: "today" = last 24 h). */
export function statusLine(xs: Progress[], lang: Lang, nowMs: number, needsTotal?: number): string {
  const day = nowMs - 86_400_000;
  const working = xs.filter((x) => x.phase === "working" || x.phase === "waiting").length;
  const needs = Math.max(needsTotal ?? 0, xs.filter((x) => x.phase === "needs").length); // needsTotal: the whole Needs-you inbox
  const done = xs.filter((x) => x.phase === "done" && Date.parse(x.at) >= day).length;
  return W[lang].line(working, needs, done);
}

/** Done share for a thin bar, 0..1 (a failed step counts as not done). */
export const doneShare = (p: Progress) => (p.phase === "done" ? 1 : p.steps.length ? p.steps.filter((s) => s.state === "done").length / p.steps.length : 0);

/** A Needs-you item (needs-you-pure Need) as a card: Decide waits for him, a failed blocker is failed, a result to check is done.
 *  open stays "": the inbox opens the item through its own BriefOpen (openTarget), never a one-tap approve. */
export function fromNeed(n: { ref: string; kind: "decide" | "unblock" | "review"; cause: string; title: string; detail?: string; at?: string }, ask: string, label: string): Progress {
  const phase: ProgressPhase = n.kind === "review" ? "done" : n.kind === "unblock" && n.cause === "failed" ? "failed" : "needs";
  return { id: n.ref, title: n.title, phase, steps: [], now: null, leftMin: null, result: { text: n.detail ? `${n.detail}. ${ask}` : ask },
    action: { kind: n.kind === "decide" ? "approve" : n.kind === "unblock" ? "retry" : "open", label, open: "" }, at: n.at ?? "" };
}
