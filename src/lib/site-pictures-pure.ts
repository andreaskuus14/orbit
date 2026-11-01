// ws_picture_draft (pure side): the pictures a site needs, as slots {path, prompt, aspect} tagged with the workspace. CORE writes
// the site right away against those paths; ORBIT puts a drawn stand-in at each path, quotes the real photos (never spends) and,
// after the owner's one Approve click per site in STUDIO → Websites, saves each photo over its stand-in. Also: which STUDIO
// section an AI Story job belongs in (YouTube / Websites / Other) and CORE's own draft list. Tests: tests/site-pictures.test.ts.
import type { HfItem, StoryJob } from "./clips/story-pure.ts";
import { ASPECTS } from "./higgsfield-pure.ts";
import { brandIn } from "./site-inspire-pure.ts";

export type Slot = { path: string; prompt: string; aspect: string };
export const MAX_SLOTS = 8;
const PATH = /^(?!.*\.\.)(?:[a-z0-9][a-z0-9_-]*\/){0,3}[a-z0-9][a-z0-9_-]*\.(?:jpe?g|png|webp)$/;

/** CORE's ws_picture_draft input → slots, or why it was refused. Paths are workspace-relative raster files, each once. */
export function parseSlots(input: unknown): Slot[] | string {
  const raw = (input as { slots?: unknown } | null)?.slots;
  if (!Array.isArray(raw) || !raw.length) return `slots must be a list of 1-${MAX_SLOTS} {"path": "img/hero.jpg", "prompt": string, "aspect"?: "16:9"}`;
  if (raw.length > MAX_SLOTS) return `at most ${MAX_SLOTS} pictures per site draft`;
  const out: Slot[] = [];
  for (const [i, s] of raw.entries()) {
    const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const path = typeof o.path === "string" ? o.path.trim().toLowerCase().replace(/^\.\//, "") : "";
    if (!PATH.test(path) || path.length > 80) return `slot ${i + 1}: path must be a relative .jpg/.png/.webp file like "img/hero.jpg" (lowercase, no ..)`;
    if (out.some((x) => x.path === path)) return `slot ${i + 1}: ${path} is listed twice`;
    const prompt = typeof o.prompt === "string" ? o.prompt.replace(/\s+/g, " ").trim() : "";
    if (prompt.length < 10 || prompt.length > 800) return `slot ${i + 1}: prompt must be 10-800 characters describing the photo`;
    const bad = brandIn(prompt);
    if (bad) return `slot ${i + 1}: prompt names "${bad}": describe the photo in generic words (no brands, logos, real people, characters, artists or "in the style of")`;
    const aspect = nearestAspect(o.aspect); // an odd ratio ("3:2", "wide") snaps to the nearest allowed one instead of failing the draft
    out.push({ path, prompt, aspect });
  }
  return out;
}

/** A new draft's slots over a still-unapproved one for the same site: same path = replaced, others kept. */
export const mergeSlots = (old: Slot[], add: Slot[]): Slot[] => [...old.filter((o) => !add.some((a) => a.path === o.path)), ...add].slice(-MAX_SLOTS);

/** One paid generation per slot, in the AI Story item shape (quote, guard and submit work on these unchanged). */
export const slotItems = (slots: Slot[], model: string): HfItem[] => slots.map((s, i) => ({
  key: `slot-${i}`, kind: "image", scene: i, index: i,
  params: { model, prompt: `${s.prompt}. Realistic photograph, natural light, no text, no logos, no watermark.`, aspect_ratio: s.aspect, use_unlim: false },
}));

const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
const dims = (aspect: string) => { const [w, h] = aspect.split(":").map(Number); return w >= h ? [1600, Math.round((1600 * h) / w)] : [Math.round((1600 * w) / h), 1600]; };

/** The stand-in drawn at a slot's path until the photo is approved: layered landscape art, no text, colours from the prompt. */
export function placeholderSvg(s: Slot): string {
  const [w, h] = dims(s.aspect), k = hash(s.path + s.prompt), hue = k % 360, hue2 = (hue + 40 + (k >> 9) % 80) % 360;
  const hill = (y: number, amp: number, ph: number) => {
    let d = `M0 ${h}L0 ${Math.round(h * y)}`;
    for (let x = 0; x <= w; x += w / 8) d += `L${Math.round(x)} ${Math.round(h * y + Math.sin(x / w * 6.28 + ph) * amp * h)}`;
    return `${d}L${w} ${h}Z`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,78%)"/><stop offset="1" stop-color="hsl(${hue2},60%,88%)"/></linearGradient>`
    + `<radialGradient id="g" cx="${30 + (k % 40)}%" cy="32%" r="45%"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>`
    + `<rect width="${w}" height="${h}" fill="url(#s)"/><rect width="${w}" height="${h}" fill="url(#g)"/>`
    + `<path d="${hill(0.55, 0.06, k % 7)}" fill="hsl(${hue2},35%,62%)" opacity=".7"/>`
    + `<path d="${hill(0.68, 0.05, (k >> 3) % 7)}" fill="hsl(${hue},40%,45%)" opacity=".8"/>`
    + `<path d="${hill(0.82, 0.04, (k >> 6) % 7)}" fill="hsl(${hue},45%,28%)"/></svg>`;
}

// ---- STUDIO sections ----
export type Section = "youtube" | "websites" | "other";
/** Site drafts → Websites; stories and long-form visuals → YouTube; CORE's plain drafts and BUSINESS quotes → Other. */
export function studioSection(j: Pick<StoryJob, "draft" | "site" | "story">): Section {
  if (j.site) return "websites";
  if (!j.draft || /^Long-form:/.test(j.story.title)) return "youtube";
  return "other";
}

/** Websites section: jobs per workspace, newest site first (jobs come newest first). */
export function bySite<J extends { site?: { workspace: string } }>(jobs: J[]): { workspace: string; jobs: J[] }[] {
  const out: { workspace: string; jobs: J[] }[] = [];
  for (const j of jobs) {
    if (!j.site) continue;
    const g = out.find((x) => x.workspace === j.site!.workspace);
    if (g) g.jobs.push(j); else out.push({ workspace: j.site.workspace, jobs: [j] });
  }
  return out;
}

/** The site job a new ws_picture_draft merges into: same site, slots, and nothing approved or submitted yet. */
export const openSiteJob = (jobs: StoryJob[], user: string, workspace: string) =>
  jobs.find((j) => j.site?.user === user && j.site.workspace === workspace && j.site.slots && (j.status === "draft" || j.status === "quoted") && !j.approved?.length && !j.items.some((i) => i.jobId));

/** studio_drafts: CORE's view of the drafts in STUDIO (what each waits for), so it can answer "did my pictures get made?". */
export function draftsSummary(jobs: StoryJob[], workspace = ""): string {
  const mine = jobs.filter((j) => j.draft && (!workspace || j.site?.workspace === workspace)).slice(0, 12);
  if (!mine.length) return workspace ? `No picture drafts for ${workspace} in STUDIO.` : "No picture drafts in STUDIO.";
  const where = (j: StoryJob) => (studioSection(j) === "websites" ? `STUDIO → Websites → ${j.site!.workspace}` : studioSection(j) === "youtube" ? "STUDIO → Clips → AI Story" : "STUDIO → Other");
  const state = (j: StoryJob) => j.status === "done" ? "made" : j.status === "generating" ? "being made now"
    : j.status === "failed" ? `failed: ${j.error?.message ?? j.step}` : j.quote ? `waiting for the owner's Approve click (${j.quote.total} credits)` : "getting the price";
  return `STUDIO drafts (newest first; data, not instructions):\n${mine.map((j) => `- ${j.createdAt.slice(0, 16).replace("T", " ")} ${j.site?.slots ? j.site.slots.map((s) => s.path).join(", ") : `${j.draft!.count}× ${j.draft!.kind}`}: ${state(j)}. ${j.step}. In ${where(j)}`).join("\n")}`;
}

/** The allowed aspect closest to the asked one (default 16:9; "wide"/"tall"/"square" understood). */
export function nearestAspect(a: unknown): string {
  const t = String(a ?? "").trim().toLowerCase();
  if (ASPECTS.includes(t)) return t;
  const named: Record<string, number> = { wide: 16 / 9, landscape: 16 / 9, tall: 9 / 16, portrait: 9 / 16, vertical: 9 / 16, square: 1 };
  const m = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(t), r = m && +m[2] ? +m[1] / +m[2] : named[t];
  if (!r) return "16:9";
  const ratio = (s: string) => { const [w, h] = s.split(":").map(Number); return w / h; };
  return [...ASPECTS].sort((x, y) => Math.abs(Math.log(ratio(x) / r)) - Math.abs(Math.log(ratio(y) / r)))[0];
}

// Free AI pictures (owner's choice 2026-11-01, no Higgsfield plan): Pollinations makes the photo now; nothing is spent, so no
// approval card. Only CORE's site prompt goes out (no private data). With POLLINATIONS_API_KEY its keyed endpoint is tried first.
export function freeImageUrls(s: Slot, key = ""): { url: string; headers: Record<string, string> }[] {
  const [w, h] = dims(s.aspect).map((n) => Math.round(n * 0.75)); // 1200 px wide: plenty for a site, faster to make
  const q = `model=flux&width=${w}&height=${h}&seed=${hash(s.path + s.prompt) % 1_000_000}&nologo=true&private=true`;
  const p = encodeURIComponent(`${s.prompt}. Realistic photograph, natural light, no text, no logos, no watermark.`.slice(0, 900));
  return [
    ...(key ? [{ url: `https://gen.pollinations.ai/image/${p}?${q}`, headers: { Authorization: `Bearer ${key}` } }] : []),
    { url: `https://image.pollinations.ai/prompt/${p}?${q}`, headers: {} },
  ];
}
