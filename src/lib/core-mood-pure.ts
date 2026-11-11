// What CORE is doing, shown on the singularity (roadmap E4). A small state machine fed by the CORE stream (busy, step
// tools, errors), the voice bus (listening, speaking) and agent tasks (awaiting approval), and a mapping from each state
// to targets for the existing singularity uniforms. No imports: loads in tests and the browser. Nothing here allocates
// per frame: resolveMood returns a string, moodLook writes into the caller's object.

export type Mood = "idle" | "listening" | "thinking" | "searching" | "tool" | "approval" | "speaking" | "error";

/** Sent on window by CorePanel as CORE streams: a tool step started, or the answer failed. */
export const CORE_SIGNAL = "orbit:core-signal";
export type CoreSignal = { type: "step"; tool: string } | { type: "error" };

/** Which planet a CORE tool works with; its colour flows into the core. "web" = the scanning beam; null = plain thinking. */
export function toolTarget(tool: string): string | null {
  if (tool === "web_search" || tool === "fetch_url") return "web";
  if (tool === "search_memory" || tool === "save_memory") return "memory";
  if (tool === "read_news") return "intelligence";
  if (tool === "ask_agent") return "agents";
  if (/^(studio_status|learned|run_scout|run_niche|schedule_approved)$/.test(tool)) return "studio";
  if (/^(plan_task|create_goal|goal_status|suggestions)$/.test(tool)) return "operations";
  if (tool === "wishlist" || tool === "add_wish") return "life";
  return null; // think, review, navigate, unknown
}

export type MoodCtx = { busy: boolean; target: string | null; errorAt: number };
export const newMoodCtx = (): MoodCtx => ({ busy: false, target: null, errorAt: -1e9 });

/** Folds a stream event into the context (in place). A new answer or its end clears the last tool. */
export function moodEvent(c: MoodCtx, ev: CoreSignal | { type: "busy"; on: boolean }, now: number): MoodCtx {
  if (ev.type === "busy") { c.busy = ev.on; c.target = null; }
  else if (ev.type === "step") c.target = toolTarget(ev.tool);
  else c.errorAt = now;
  return c;
}

export const ERROR_MS = 1400; // the desaturation is brief

/** One state wins, most urgent first: a fresh error, CORE's voice, his voice, the work, then a pending approval (agent
 *  tasks can wait for hours, so it must not hide live activity) over idle. */
export function resolveMood(c: MoodCtx, now: number, s: { listening: boolean; mic: number; spk: number; approval: boolean }): Mood {
  if (now - c.errorAt < ERROR_MS && now >= c.errorAt) return "error";
  if (s.spk > 0.02) return "speaking";
  if (s.listening || s.mic > 0.12) return "listening";
  if (!c.busy) return s.approval ? "approval" : "idle";
  return c.target === "web" ? "searching" : c.target ? "tool" : "thinking";
}

/** Targets for the uniforms, all 0..1 except breath (Hz). The component eases toward them with expDamp. */
export type Look = { breath: number; tight: number; face: number; swirl: number; counter: number; beam: number; tint: number; amber: number; ripple: number; desat: number };
export const newLook = (): Look => ({ breath: 0.17, tight: 0, face: 0, swirl: 0, counter: 0, beam: 0, tint: 0, amber: 0, ripple: 0, desat: 0 });

export function moodLook(m: Mood, out: Look): Look {
  out.breath = m === "idle" ? 0.17 : m === "thinking" || m === "searching" || m === "tool" ? 0.4 : 0.25;
  out.tight = m === "listening" ? 1 : m === "speaking" ? 0.4 : 0;
  out.face = m === "listening" ? 1 : m === "speaking" ? 0.5 : 0;
  out.swirl = m === "thinking" ? 1 : m === "searching" || m === "tool" ? 0.5 : 0;
  out.counter = m === "thinking" ? 1 : m === "searching" || m === "tool" ? 0.4 : 0;
  out.beam = m === "searching" ? 1 : 0;
  out.tint = m === "tool" ? 1 : 0;
  out.amber = m === "approval" ? 1 : 0;
  out.ripple = m === "speaking" ? 1 : 0;
  out.desat = m === "error" ? 1 : 0;
  return out;
}

/** How fast each state is entered (s): the error snaps in, everything else glides. */
export const moodTau = (m: Mood) => (m === "error" ? 0.08 : m === "listening" ? 0.25 : 0.5);
