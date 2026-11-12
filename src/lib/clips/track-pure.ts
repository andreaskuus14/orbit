// STUDIO Production track (Y2, pure; tested in tests/production-track.test.ts): the owner's staged video method as one state machine.
// Each stage has inputs, one output and a gate. Stages 4 (style frames) and 5 (motion test) always stop for his click on the exact
// version (content hash, same rule as approval-pure approvalGate); nothing skips them. Generation that spends credits runs only with
// his story.approve hash of spendContent; publishing stays the Clip Factory studio.publish click. Nothing here spends or publishes.
import { contentHash } from "../approval-pure.ts";

export type Gate = "check" | "owner";
export type Stage = { id: StageId; name: string; inputs: string; output: string; gate: Gate; spends?: boolean; tool: string };
export type StageId = "references" | "script" | "storyboard" | "style" | "motion" | "animation" | "sound" | "render";
export const STAGES: Stage[] = [
  { id: "references", name: "References", inputs: "the idea", output: "reference links or files (what it should feel like)", gate: "check", tool: "VAULT / web" },
  { id: "script", name: "Script", inputs: "references", output: "script: what is seen + what is heard, per beat", gate: "check", tool: "AI Story (story-pure)" },
  { id: "storyboard", name: "Storyboard", inputs: "script", output: "one panel per beat (camera, pose, timing)", gate: "check", tool: "AI Story scenes" },
  { id: "style", name: "Style frames", inputs: "storyboard", output: "style frames he approves", gate: "owner", spends: true, tool: "Higgsfield image (story.approve) + art director" },
  { id: "motion", name: "Motion test", inputs: "approved style frames", output: "ONE polished 5-8 s motion test", gate: "owner", spends: true, tool: "story-render / Higgsfield video (story.approve) + frame review" },
  { id: "animation", name: "Animation", inputs: "approved motion test + approved style frames", output: "full animation (anticipation, easing, overlap, clear poses, holds)", gate: "check", spends: true, tool: "story-render (story.approve)" },
  { id: "sound", name: "Sound + edit sync", inputs: "animation", output: "voice and sound synced to the cut", gate: "check", tool: "Kokoro voice + story-render" },
  { id: "render", name: "Render + review", inputs: "synced edit", output: "final render he reviews (revise or done)", gate: "owner", tool: "story-render + frame review + art director; publish = Clip Factory" },
];
export const MOTION_SEC = { min: 5, max: 8 };
export const ACTING = ["anticipation", "easing", "overlap", "clear poses", "holds"] as const;

export type Artifact = { ref: string; sha: string; note?: string; sec?: number; at: string; approved?: string; approvedAt?: string };
export type Track = { v: 1; id: string; title: string; createdAt: string; stage: number; out: Partial<Record<StageId, Artifact>>; frames: Artifact[]; revisions: number; spent: string[] };

export const newTrack = (id: string, title: string, at: string): Track => ({ v: 1, id, title: title.trim().slice(0, 120), createdAt: at, stage: 0, out: {}, frames: [], revisions: 0, spent: [] });
const idx = (s: StageId) => STAGES.findIndex((x) => x.id === s);
/** What an approval covers: the exact artifact incl. the file's sha256 (or, for stage 4, the exact frame). Any change = fresh approval.
 *  The route refreshes `sha` from disk on every read, so a file edited after approval no longer matches. */
export const artifactContent = (s: StageId, a: Pick<Artifact, "ref" | "sha" | "note" | "sec">) => ({ stage: s, ref: a.ref, sha: a.sha, note: a.note ?? "", sec: a.sec ?? null });
const ok = async (s: StageId, a: Artifact | undefined) => !!a?.approved && !!a.sha && a.approved === (await contentHash(artifactContent(s, a)));

export const motionApproved = (t: Track) => ok("motion", t.out.motion);
export async function approvedFrames(t: Track) { const r: Artifact[] = []; for (const f of t.frames) if (await ok("style", f)) r.push(f); return r; }

/** "" when this style frame may be used downstream; otherwise why not. */
export async function useFrameProblem(t: Track, ref: string): Promise<string> {
  const f = t.frames.find((x) => x.ref === ref);
  if (!f) return "Unknown style frame";
  return (await ok("style", f)) ? "" : "This style frame isn't approved by you (or changed since): approve it first";
}
/** "" when the full video (stage 6) may start; the motion test must be approved first, always. */
export async function fullVideoProblem(t: Track): Promise<string> {
  if (!(await motionApproved(t))) return "The motion test isn't approved: approve one 5-8 s motion test first";
  if (!(await approvedFrames(t)).length) return "No approved style frame";
  return "";
}

/** Record a stage's output (or a style frame). Never approves. Any resubmit clears the approvals of this stage and every later one
 *  and reopens the track here: downstream work was approved against what just changed. `sha` = the file's sha256 ("" = not a file). */
export function submit(t: Track, s: StageId, a: { ref: unknown; sha?: unknown; note?: unknown; sec?: unknown }, at: string): string {
  const i = idx(s), ref = typeof a.ref === "string" ? a.ref.trim() : "";
  if (i < 0) return "Unknown stage";
  if (i > t.stage) return `Finish ${STAGES[t.stage].name} first`;
  if (ref.length < 3 || ref.length > 500) return "Give a link, path or text of 3-500 characters";
  const art: Artifact = { ref, sha: typeof a.sha === "string" ? a.sha : "", at, ...(typeof a.note === "string" && a.note.trim() ? { note: a.note.trim().slice(0, 500) } : {}) };
  if (s === "motion") {
    const sec = Number(a.sec);
    if (!(sec >= MOTION_SEC.min && sec <= MOTION_SEC.max)) return "A motion test is 5-8 seconds";
    art.sec = sec;
  }
  const unapprove = (x?: Artifact) => { if (x) { delete x.approved; delete x.approvedAt; } };
  for (const st of STAGES.slice(i)) { if (st.id === "style") t.frames.forEach(unapprove); unapprove(t.out[st.id]); }
  if (s === "style") t.frames = [...t.frames.filter((f) => f.ref !== ref), art];
  else t.out[s] = art;
  t.stage = Math.min(t.stage, i);
  return "";
}

/** His click: `hash` is contentHash(artifactContent(...)) of what he read. */
export async function approve(t: Track, s: StageId, ref: string, hash: unknown, at: string): Promise<string> {
  if (STAGES[idx(s)]?.gate !== "owner") return "This stage has no approval step";
  const a = s === "style" ? t.frames.find((f) => f.ref === ref) : t.out[s]?.ref === ref ? t.out[s] : undefined;
  if (!a) return "Nothing to approve";
  if (!a.sha) return "Only a file in STUDIO can be approved (its content is what you approve)";
  if (s === "render" && !(await approvedFrames(t)).length) return "No approved style frame";
  if (typeof hash !== "string" || hash !== (await contentHash(artifactContent(s, a)))) return "The content changed since you read it: reload and read it again";
  a.approved = hash; a.approvedAt = at;
  return "";
}

/** "" when the current stage's gate is passed. */
export async function gateProblem(t: Track): Promise<string> {
  const s = STAGES[t.stage];
  if (s.id === "style") return (await approvedFrames(t)).length ? "" : "Waiting for you to approve a style frame";
  if (s.id === "animation") { const p = await fullVideoProblem(t); if (p) return p; }
  const a = t.out[s.id];
  if (!a) return `Needs: ${s.output}`;
  if (s.gate === "owner" && !(await ok(s.id, a))) return `Waiting for you to approve the ${s.name.toLowerCase()}`;
  return "";
}
export async function advance(t: Track): Promise<string> {
  const p = await gateProblem(t);
  if (p) return p;
  if (t.stage >= STAGES.length - 1) return "Last stage: done";
  t.stage++;
  if (STAGES[t.stage].id === "animation") { const q = await fullVideoProblem(t); if (q) { t.stage--; return q; } }
  return "";
}
/** Stage 8 review said revise: back to animation; the motion test and frames stay approved. */
export function revise(t: Track): string {
  if (STAGES[t.stage].id !== "render") return "Revise is the review step";
  delete t.out.render; delete t.out.sound; delete t.out.animation;
  t.stage = idx("animation"); t.revisions++;
  return "";
}

/** A paid generation for a stage (Higgsfield). Track rules first (stage reached, motion test approved before the full video, only
 *  approved frames), then `spend(seen)` = approveStory in production (track.ts), which re-checks the quote hash, Stop-all, Autonomy,
 *  the weekly credit cap and one run at a time. A `seen` hash that already paid for this track is refused: one hash, one spend. */
export async function generate<R>(t: Track, s: StageId, seen: unknown, frames: string[], spend: (seen: string) => Promise<R | string>): Promise<{ ok: R } | { error: string }> {
  if (!STAGES[idx(s)]?.spends) return { error: "This stage doesn't generate" };
  if (idx(s) > t.stage) return { error: `Finish ${STAGES[t.stage].name} first` };
  if (s === "animation") { const p = await fullVideoProblem(t); if (p) return { error: p }; }
  if (s !== "style") for (const f of frames) { const p = await useFrameProblem(t, f); if (p) return { error: p }; }
  if (typeof seen !== "string" || !seen) return { error: "Needs your approval of this exact quote" };
  if (t.spent.includes(seen)) return { error: "This approval was already used: get a new quote and approve it" };
  const r = await spend(seen);
  if (typeof r === "string") return { error: r };
  t.spent.push(seen);
  return { ok: r };
}

/** One-page state: current stage, what waits for him, every artifact link. */
export async function summary(t: Track) {
  const waiting: { stage: StageId; ref: string; hash: string }[] = [];
  for (const f of t.frames) if (!(await ok("style", f))) waiting.push({ stage: "style", ref: f.ref, hash: await contentHash(artifactContent("style", f)) });
  for (const s of STAGES) { const a = t.out[s.id]; if (s.gate === "owner" && a && !(await ok(s.id, a))) waiting.push({ stage: s.id, ref: a.ref, hash: await contentHash(artifactContent(s.id, a)) }); }
  return { current: STAGES[t.stage].id, gate: await gateProblem(t), waiting };
}

export function trackProblem(x: unknown, id: string): string {
  const t = x as Track;
  if (!t || t.v !== 1 || t.id !== id || typeof t.title !== "string" || !Number.isInteger(t.stage) || t.stage < 0 || t.stage >= STAGES.length) return "bad track";
  if (typeof t.out !== "object" || !Array.isArray(t.frames) || !Array.isArray(t.spent)) return "bad track";
  return "";
}
