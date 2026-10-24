// AI Story (Clip Factory): pure logic for the story package, the Higgsfield cost/approval gate, the MCP tool guard and the
// ffmpeg assembly graph. Server glue: story.ts; engine: story-render.ts; Higgsfield: higgsfield.ts.
import type { Word } from "./pure.ts";

export type StoryScene = { visual: string; narration: string; sec: number; camera: string };
export type Story = { title: string; hook: string; scenes: StoryScene[] };
/** voice: "kokoro:<voice>" (local, free), "hf:<voice_id>" (Higgsfield seed_audio preset voice, costs credits) or "none". */
export type StoryOpts = { idea: string; style: string; length: number; voice: string; motion: "stills" | "video" };
export type HfKind = "image" | "video" | "audio";
export type HfItem = { key: string; kind: HfKind; scene: number; index: number; params: Record<string, unknown>;
  credits?: number; jobId?: string; status?: "pending" | "done" | "failed"; url?: string; file?: string; error?: string };
export type HfErrorKind = "not_connected" | "credits" | "paid_plan" | "other";
export type StoryStatus = "draft" | "quoted" | "generating" | "assembling" | "done" | "failed";
export type StoryJob = { v: 1; id: string; createdAt: string; updatedAt: string; status: StoryStatus; step: string; opts: StoryOpts; story: Story; items: HfItem[];
  quote?: { total: number; balance: number | null; plan: string | null; fingerprint: string; at: string };
  approved?: { at: string; credits: number }[]; // every owner click that allowed spending (resumes add one)
  clipJob?: string; error?: { kind: HfErrorKind; message: string }; warnings: string[] };
export type Models = { image: string; video: string; audio: string };

export const STORY_SCENES = { min: 5, max: 9 };
export const STORY_LENGTHS = [30, 45, 60];
export const KOKORO_VOICES = ["af_heart", "af_bella", "af_nicole", "am_michael", "am_fenrir", "bf_emma", "bm_george"];
export const XFADE = 0.5;
export const W = 1080, H = 1920, FPS = 30;
const SCENE_SEC = { min: 2.5, max: 12 };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown, max: number) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Owner input from the request body; an error message when it doesn't fit. */
export function validStoryOpts(b: Record<string, unknown>): StoryOpts | string {
  const idea = str(b.idea, 1000), style = str(b.style, 200);
  if (idea.length < 3) return "Write an idea first (a sentence is enough)";
  const length = Number(b.length ?? 45);
  if (!STORY_LENGTHS.includes(length)) return `length must be one of ${STORY_LENGTHS.join(", ")} seconds`;
  const voice = typeof b.voice === "string" ? b.voice : "kokoro:af_heart";
  const ok = voice === "none" || (voice.startsWith("kokoro:") && KOKORO_VOICES.includes(voice.slice(7))) || /^hf:[\w-]{1,80}$/.test(voice);
  if (!ok) return "voice must be a local Kokoro voice, none, or hf:<Higgsfield voice id>";
  const motion = b.motion ?? "stills";
  if (motion !== "stills" && motion !== "video") return "motion must be stills or video";
  return { idea, style, length, voice, motion };
}

/** Strips code fences/prose around the first JSON object of a model reply. */
export function jsonObject(text: string): Record<string, unknown> | null {
  const t = text.replace(/```(?:json)?/g, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { const j = JSON.parse(t.slice(a, b + 1)); return isObj(j) ? j : null; } catch { return null; }
}

/** Checks a story (from Claude or the owner's edits); `fit` scales the scene lengths to `length` seconds (Claude's drafts, not edits). */
export function validStory(x: unknown, length: number, fit = true): Story | string {
  if (!isObj(x)) return "story must be a JSON object";
  const title = str(x.title, 100), hook = str(x.hook, 80);
  if (!title || !hook) return "title and hook are required";
  if (!Array.isArray(x.scenes) || x.scenes.length < STORY_SCENES.min || x.scenes.length > STORY_SCENES.max) return `the story needs ${STORY_SCENES.min}-${STORY_SCENES.max} scenes`;
  const scenes: StoryScene[] = [];
  for (const [i, s] of x.scenes.entries()) {
    if (!isObj(s)) return `scene ${i + 1} is not an object`;
    const visual = str(s.visual, 1200), narration = str(s.narration, 400), camera = str(s.camera, 80), sec = Number(s.sec);
    if (!visual || !narration) return `scene ${i + 1} needs a visual prompt and narration`;
    if (!Number.isFinite(sec) || sec <= 0) return `scene ${i + 1} needs a duration in seconds`;
    scenes.push({ visual, narration, camera, sec });
  }
  const total = scenes.reduce((s, c) => s + c.sec, 0), k = fit ? length / total : 1;
  return { title, hook, scenes: scenes.map((s) => ({ ...s, sec: round1(Math.min(SCENE_SEC.max, Math.max(SCENE_SEC.min, s.sec * k))) })) };
}

export const parseStory = (text: string, length: number): Story | string => {
  const j = jsonObject(text);
  return j ? validStory(j, length) : "Claude's reply wasn't a JSON story";
};

/** What Higgsfield must make, one item per paid generation. Prompts are self-contained, so the style goes into every one. */
export function storyItems(story: Story, o: StoryOpts, m: Models): HfItem[] {
  const look = o.style ? ` Style: ${o.style}.` : "";
  const items: HfItem[] = [];
  const add = (kind: HfKind, scene: number, params: Record<string, unknown>) =>
    items.push({ key: `${kind}-${scene}`, kind, scene, index: items.length, params: { ...params, use_unlim: false } }); // use_unlim false: pay with credits, never the free-trial prompt
  story.scenes.forEach((s, i) => {
    const prompt = `${s.visual}${look} Vertical 9:16 composition, no text or captions in the image.`;
    if (o.motion === "video") add("video", i, { model: m.video, prompt: `${prompt} Camera: ${s.camera || "slow push in"}.`, aspect_ratio: "9:16", duration: 5 });
    else add("image", i, { model: m.image, prompt, aspect_ratio: "9:16" });
  });
  if (o.voice.startsWith("hf:")) story.scenes.forEach((s, i) => add("audio", i, { model: m.audio, prompt: s.narration, voice_type: "preset", voice_id: o.voice.slice(3) }));
  return items;
}

/** FNV-1a of the story + options: a quote is only valid for the exact script it priced. */
export function fingerprint(story: Story, o: StoryOpts): string {
  let h = 0x811c9dc5;
  for (const c of JSON.stringify([story, o])) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(16);
}

/** Items still to be paid for (no Higgsfield job yet) and their quoted total. */
export const unpaid = (items: HfItem[]) => items.filter((i) => !i.jobId);
export const quoteTotal = (items: HfItem[]) => Math.round(unpaid(items).reduce((s, i) => s + (i.credits ?? 0), 0) * 100) / 100;

/** ORBIT rule 6: spending needs the owner's click on the exact quoted number. "" = allowed. */
export function approveProblem(job: StoryJob, credits: unknown): string {
  if (job.status === "generating" || job.status === "assembling") return "This story is already being made";
  if (job.status === "done") return "This story is already done";
  const q = job.quote;
  if (!q) return "Get the cost first";
  if (q.fingerprint !== fingerprint(job.story, job.opts)) return "The script changed after the quote: get the cost again";
  if (unpaid(job.items).some((i) => typeof i.credits !== "number")) return "The quote is missing a price: get the cost again";
  const total = quoteTotal(job.items);
  if (credits !== total) return `Approve the quoted total (${total} credits)`;
  if (q.balance !== null && q.balance < total) return `Not enough Higgsfield credits: ${total} needed, ${q.balance} left`;
  return "";
}

/** Classifies a Higgsfield/CLI failure for the UI. */
export function hfErrorKind(msg: string): HfErrorKind {
  if (/not[ _]connected|no such tool|unknown tool|not available|unauthori[sz]ed|401|log ?in|sign ?in|authenticat|oauth/i.test(msg)) return "not_connected";
  if (/insufficient|not enough credit|out of credit|credit.*(low|exhaust)|balance/i.test(msg)) return "credits";
  if (/paid plan|upgrade|subscription|plan (doesn|does not)|locked|premium|not included/i.test(msg)) return "paid_plan";
  return "other";
}

/** A reply's {"error":{kind,message}}, if it has one. */
function replyError(j: Record<string, unknown>): { kind: HfErrorKind; message: string } | null {
  if (!isObj(j.error)) return null;
  const message = str(j.error.message, 400) || "Higgsfield reported an error";
  const k = j.error.kind;
  return { kind: k === "not_connected" || k === "credits" || k === "paid_plan" ? k : hfErrorKind(message), message };
}
export type HfReply<T> = { ok: T } | { error: { kind: HfErrorKind; message: string } };
const bad = (message: string): HfReply<never> => ({ error: { kind: hfErrorKind(message), message } });

export function parseQuoteReply(text: string, keys: string[]): HfReply<{ balance: number | null; plan: string | null; credits: Record<string, number> }> {
  const j = jsonObject(text);
  if (!j) return bad(`Unreadable quote reply: ${text.slice(0, 200)}`);
  const e = replyError(j);
  if (e) return { error: e };
  const credits: Record<string, number> = {};
  for (const it of Array.isArray(j.items) ? j.items : []) if (isObj(it) && keys.includes(it.key as string) && Number.isFinite(it.credits) && (it.credits as number) >= 0) credits[it.key as string] = it.credits as number;
  const missing = keys.filter((k) => !(k in credits));
  if (missing.length) return { error: { kind: "other", message: `No price for ${missing.join(", ")}` } };
  return { ok: { balance: Number.isFinite(j.balance) ? (j.balance as number) : null, plan: str(j.plan, 60) || null, credits } };
}

/** Submit reply: job ids by our item index. Partial results are kept (they were paid for). */
export function parseSubmitReply(text: string): { jobs: Record<number, string>; error?: { kind: HfErrorKind; message: string } } {
  const j = jsonObject(text);
  const jobs: Record<number, string> = {};
  for (const x of Array.isArray(j?.jobs) ? j.jobs : []) if (isObj(x) && Number.isInteger(x.index) && typeof x.job_id === "string" && /^[0-9a-f-]{36}$/i.test(x.job_id)) jobs[x.index as number] = x.job_id;
  const e = j ? replyError(j) : { kind: "other" as const, message: `Unreadable submit reply: ${text.slice(0, 200)}` };
  return e ? { jobs, error: e } : { jobs };
}

export type JobState = { index: number; status: "pending" | "done" | "failed"; url?: string; error?: string };
export function parseWaitReply(text: string): HfReply<JobState[]> {
  const j = jsonObject(text);
  if (!j) return bad(`Unreadable status reply: ${text.slice(0, 200)}`);
  const e = replyError(j);
  if (e) return { error: e };
  const out: JobState[] = [];
  for (const x of Array.isArray(j.jobs) ? j.jobs : []) {
    if (!isObj(x) || !Number.isInteger(x.index)) continue;
    const s = String(x.status ?? "").toLowerCase();
    const status = /complet|done|succe|finish/.test(s) ? "done" : /fail|error|cancel|nsfw|reject/.test(s) ? "failed" : "pending";
    const url = typeof x.url === "string" && /^https:\/\//.test(x.url) ? x.url : undefined;
    out.push({ index: x.index as number, status: status === "done" && !url ? "failed" : status, url, error: str(x.error, 300) || (status === "done" && !url ? "no result URL" : undefined) });
  }
  return { ok: out };
}

// ---- the MCP guard (scripts/hf-guard.ts runs it as a Claude Code PreToolUse hook) ----

export const HF = "mcp__higgsfield__";
export type GuardPolicy = { mode: "quote" } | { mode: "wait" } | { mode: "submit"; allow: { tool: string; requests: unknown[] }[] };
export const QUOTE_TOOLS = ["generate_image", "generate_video", "generate_audio", "balance"].map((t) => HF + t);
export const WAIT_TOOLS = [HF + "jobs_wait"];
export const BATCH_TOOL: Record<HfKind, string> = { image: HF + "generate_image_batch", video: HF + "generate_video_batch", audio: HF + "generate_audio_batch" };

const canon = (x: unknown): unknown => Array.isArray(x) ? x.map(canon) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x;
/** A batch request list as sent: sorted by index, count:1 dropped (the default), so harmless spelling differences still match. */
const normRequests = (r: unknown) => Array.isArray(r) ? JSON.stringify(canon([...r].map((q) => {
  if (!isObj(q) || !isObj(q.params)) return q;
  const { count, ...params } = q.params;
  return { ...q, params: count === 1 ? params : q.params };
}).sort((a, b) => Number(isObj(a) && a.index) - Number(isObj(b) && b.index)))) : "";

/** Decides one tool call. Quote: only price checks (get_cost:true) and balance. Wait: only jobs_wait.
 *  Submit: only the exact approved batches, each once (`used`: allow indices already spent). */
export function guardDecision(p: GuardPolicy, used: number[], tool: string, input: unknown): { allow: boolean; reason: string; use?: number } {
  const no = (reason: string) => ({ allow: false, reason: `ORBIT blocked ${tool}: ${reason}` });
  if (p.mode === "wait") return WAIT_TOOLS.includes(tool) ? { allow: true, reason: "" } : no("only jobs_wait may run while polling");
  if (p.mode === "quote") {
    if (!QUOTE_TOOLS.includes(tool)) return no("only cost checks may run before the owner approves");
    if (tool.endsWith("balance")) return { allow: true, reason: "" };
    let params = isObj(input) ? input.params : undefined;
    if (typeof params === "string") { try { params = JSON.parse(params); } catch { params = undefined; } }
    return isObj(params) && params.get_cost === true ? { allow: true, reason: "" } : no("a quote call must set params.get_cost to true");
  }
  const req = normRequests(isObj(input) ? input.requests : undefined);
  const i = p.allow.findIndex((a, k) => !used.includes(k) && a.tool === tool && normRequests(a.requests) === req);
  return i >= 0 ? { allow: true, reason: "", use: i } : no("not the exact batch the owner approved (or already sent)");
}

// ---- assembly ----

/** Each scene lasts its planned time, longer when its narration needs it. */
export const sceneSecs = (planned: number[], narration: (number | null)[]) => planned.map((s, i) => round1(Math.max(s, (narration[i] ?? 0) + 0.4)));

/** Zoompan expressions for a camera note: push in (default), pull out, or a pan. `f` = frames in the shot. */
export function kenBurns(camera: string, f: number): { z: string; x: string; y: string } {
  const t = `(on/${Math.max(1, f - 1)})`, cx = "iw/2-(iw/zoom/2)", cy = "ih/2-(ih/zoom/2)";
  const c = camera.toLowerCase();
  if (/out|reveal|pull/.test(c)) return { z: `1.15-0.15*${t}`, x: cx, y: cy };
  if (/left/.test(c)) return { z: "1.15", x: `(iw-iw/zoom)*(1-${t})`, y: cy };
  if (/right|pan|track/.test(c)) return { z: "1.15", x: `(iw-iw/zoom)*${t}`, y: cy };
  if (/up|tilt|rise/.test(c)) return { z: "1.15", x: cx, y: `(ih-ih/zoom)*(1-${t})` };
  if (/down|descend/.test(c)) return { z: "1.15", x: cx, y: `(ih-ih/zoom)*${t}` };
  return { z: `1+0.15*${t}`, x: cx, y: cy };
}

export type AssembleScene = { file: string; video: boolean; sec: number; camera: string; narration?: string };
/** ffmpeg args for the final 1080x1920 Short: Ken Burns stills (or clips), crossfades, narration per scene, optional music bed, optional ASS captions. */
export function assembleArgs(o: { scenes: AssembleScene[]; music?: string; ass?: string; out: string }): string[] {
  const n = o.scenes.length, total = round1(o.scenes.reduce((s, c) => s + c.sec, 0));
  const inputs: string[] = [], f: string[] = [];
  let k = 0;
  o.scenes.forEach((s, i) => {
    const len = s.sec + (i < n - 1 ? XFADE : 0), frames = Math.round(len * FPS);
    if (s.video) {
      inputs.push("-stream_loop", "-1", "-t", String(len), "-i", s.file);
      f.push(`[${k}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},trim=duration=${len},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
    } else {
      inputs.push("-i", s.file);
      const kb = kenBurns(s.camera, frames); // 1.5x supersampled first so the slow zoom doesn't stair-step
      f.push(`[${k}:v]scale=${W * 1.5}:${H * 1.5}:force_original_aspect_ratio=increase,crop=${W * 1.5}:${H * 1.5},setsar=1,zoompan=z='${kb.z}':x='${kb.x}':y='${kb.y}':d=${frames}:s=${W}x${H}:fps=${FPS},format=yuv420p[v${i}]`);
    }
    k++;
  });
  let last = "v0", at = 0;
  for (let i = 1; i < n; i++) {
    at = round1(at + o.scenes[i - 1].sec);
    f.push(`[${last}][v${i}]xfade=transition=fade:duration=${XFADE}:offset=${at}[x${i}]`);
    last = `x${i}`;
  }
  f.push(`[${last}]${o.ass ? `ass=${o.ass},` : ""}format=yuv420p[v]`);
  o.scenes.forEach((s, i) => {
    if (s.narration) { inputs.push("-i", s.narration); f.push(`[${k++}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:${s.sec},asetpts=N/SR/TB[a${i}]`); }
    else f.push(`anullsrc=r=48000:cl=stereo,atrim=0:${s.sec}[a${i}]`);
  });
  f.push(`${o.scenes.map((_, i) => `[a${i}]`).join("")}concat=n=${n}:v=0:a=1[narr]`);
  if (o.music) {
    inputs.push("-stream_loop", "-1", "-i", o.music);
    f.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.12,atrim=0:${total},afade=t=out:st=${Math.max(0, round1(total - 1.5))}:d=1.5[mus]`,
      "[narr][mus]amix=inputs=2:duration=first:normalize=0[a]");
  } else f.push("[narr]anull[a]");
  return ["-y", "-hide_banner", ...inputs, "-filter_complex", f.join(";"), "-map", "[v]", "-map", "[a]", "-t", String(total),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-r", String(FPS), "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", o.out];
}

/** Caption timing without Whisper: each scene's narration spread over its spoken time, by word length. */
export function scriptWords(narration: string[], starts: number[], spoken: number[]): Word[] {
  return narration.flatMap((text, i) => {
    const ws = text.split(/\s+/).filter(Boolean), chars = ws.reduce((s, w) => s + w.length + 1, 0) || 1;
    let t = starts[i];
    return ws.map((w) => { const d = (spoken[i] * (w.length + 1)) / chars, x = { start: round1(t), end: round1(t + d), text: w }; t += d; return x; });
  });
}

/** A mono 16-bit PCM WAV of silence (fake narration in dry runs). */
export function silentWav(sec: number, rate = 24000): Uint8Array {
  const n = Math.round(sec * rate), b = new Uint8Array(44 + n * 2), v = new DataView(b.buffer);
  const s = (o: number, t: string) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  s(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); s(8, "WAVE"); s(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, "data"); v.setUint32(40, n * 2, true);
  return b;
}

/** Checks a story state file read from disk. */
export function storyProblem(x: unknown, id?: string): string {
  if (!isObj(x) || x.v !== 1) return "not a story file";
  if (typeof x.id !== "string" || (id !== undefined && x.id !== id)) return "id missing or doesn't match the file name";
  if (!isObj(x.story) || !isObj(x.opts) || !Array.isArray(x.items) || !Array.isArray(x.warnings)) return "story, options or items missing";
  return "";
}
