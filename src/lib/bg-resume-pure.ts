// Background CORE turns that survive a restart. Pure; tested in tests/bg-resume.test.ts; IO: bg-resume.ts (<ORBIT data dir>/bg-turns/).
// When a CORE turn moves to the background (core-turn.ts inBackground), a small record is kept on disk until it finishes. A restart
// leaves the record behind; the scheduler's boot sweep resumes it under a job-log lease, at most MAX_RESUMES times, then fails it
// with a plain reason. The in-memory tool results (CoreHandoff carry) are gone after a restart, so the resume gets what was done as
// a context line and continues from the chat history.
export type BgTurn = { taskId: string; userId: string; chatId: string; request: string; title: string; done: string[]; sessionId?: string; lang?: string; attempts: number; createdAt: string; lastError?: string };

export const MAX_RESUMES = 2;
export const RESUME_MAX_AGE = 24 * 3600_000; // older than this: ORBIT was off too long, the request is likely stale
const MAX_DONE = 20;
const id = (s: unknown) => typeof s === "string" && /^[\w-]{1,80}$/.test(s);

/** The chat note when a background turn is cancelled or Stop-all halts it: tool steps that already finished can't be undone from here. */
export function stoppedNote(stopAll: boolean, trace: { step: string; ok?: boolean }[]): string {
  const ran = [...new Set(trace.filter((s) => s.ok !== false && !["search_memory", "think", "review", "fallback", "reflex", "route", "native"].includes(s.step)).map((s) => s.step))];
  return `${stopAll ? "Stopped: Stop-all is on." : "Cancelled."} No further steps ran.${ran.length ? ` Already done before the stop (not undone): ${ran.join(", ")}.` : ""}`;
}

/** Done-so-far lines from a carried trace (tool steps only, short): what the resume is told not to redo. */
export const doneSoFar = (trace: { step: string; detail?: string; ok?: boolean }[]) =>
  trace.filter((s) => s.ok !== false && !["search_memory", "think", "review", "fallback", "reflex"].includes(s.step))
    .map((s) => `${s.step}${s.detail ? `: ${s.detail}` : ""}`.replace(/\s+/g, " ").slice(0, 160)).slice(-MAX_DONE);

export function newBgTurn(x: { taskId: string; userId: string; chatId: string; request: string; title: string; done?: string[]; sessionId?: string; lang?: string }, now: number): BgTurn {
  return { ...x, request: x.request.slice(0, 8000), done: (x.done ?? []).slice(-MAX_DONE), attempts: 0, createdAt: new Date(now).toISOString() };
}

export function parseBgTurn(raw: unknown): BgTurn | null {
  const r = raw as Partial<BgTurn> | null;
  if (!r || typeof r !== "object" || !id(r.taskId) || !id(r.userId) || !id(r.chatId) || typeof r.request !== "string" || !r.request || typeof r.createdAt !== "string") return null;
  return { taskId: r.taskId!, userId: r.userId!, chatId: r.chatId!, request: r.request.slice(0, 8000), title: typeof r.title === "string" ? r.title.slice(0, 120) : "CORE",
    done: Array.isArray(r.done) ? r.done.filter((d): d is string => typeof d === "string").slice(-MAX_DONE) : [],
    ...(typeof r.sessionId === "string" ? { sessionId: r.sessionId } : {}), ...(typeof r.lang === "string" ? { lang: r.lang } : {}),
    attempts: Number.isSafeInteger(r.attempts) && r.attempts! >= 0 ? r.attempts! : 0, createdAt: r.createdAt, ...(typeof r.lastError === "string" ? { lastError: r.lastError.slice(0, 300) } : {}) };
}

/** What the boot sweep does with a left-over record: resume it once more, or fail it with a reason the owner can read. */
export function resumePlan(r: BgTurn, now: number): { do: "resume" } | { do: "fail"; reason: string } {
  if (r.attempts >= MAX_RESUMES) return { do: "fail", reason: `ORBIT restarted while this ran in the background and couldn't finish it after ${MAX_RESUMES} tries${r.lastError ? ` (${r.lastError.slice(0, 120)})` : ""}. Ask again to restart it.` };
  if (now - Date.parse(r.createdAt) > RESUME_MAX_AGE) return { do: "fail", reason: "ORBIT was off for more than a day while this ran in the background, so it wasn't resumed. Ask again if you still want it." };
  return { do: "resume" };
}

/** The resumed turn's context: it continues, it doesn't start over (finished steps may already have changed his data). */
export const resumeContext = (r: BgTurn) =>
  `\n\nRESUMED BACKGROUND WORK: ORBIT restarted while your earlier answer to the latest request was running in the background. ${r.done.length ? `Steps that had already finished (do not redo them; check their result instead if needed):\n${r.done.map((d) => `- ${d}`).join("\n")}` : "No step had finished yet."}\nContinue from there and finish the request.`;

/** The chat history for the resume: up to and including the request's own message (later lines are the handoff reply). */
export function resumeHistory<T extends { role: string; content: string }>(rows: T[], request: string): T[] {
  const i = rows.findLastIndex((m) => m.role === "user" && m.content.startsWith(request.slice(0, 200)));
  return i < 0 ? [] : rows.slice(0, i + 1);
}
