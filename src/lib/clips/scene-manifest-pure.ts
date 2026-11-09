// Scene manifest (W03 / E01, E03, E05, E07): a provider-independent, versioned description of a short film, one entry per scene
// (beat, character, shot, spoken line, audio, duration in frames, dependencies). Each scene's render is keyed by a content hash
// of its inputs plus the hashes of what it depends on, so an edit dirties only that scene, its dependants and the final join.
// Also: the fake voice (a syllable-shaped tone), captions, per-format layout with safe zones, and the export preflight.
// I/O (ffmpeg, files, cache): scene-render.ts. The AI Story job (story-pure.ts) stays as it is; this sits beside its renderer.
import { createHash } from "node:crypto";
import { assText, assTime } from "./pure.ts";
import { actingReport, rig, rigBox, sample, type Acting, type Key, type Pose } from "./stickman-pure.ts";

export const MANIFEST_V = 1;
export const RENDERER = "stick-1"; // bump when the renderer's output changes, so every cached scene re-renders
export const FPS = 30, RATE = 48000;

export type Character = { kind: "character"; name: string; color: string; line: number; headR: number };
export type Prop = { kind: "rect"; x0: number; y0: number; x1: number; y1: number; color: string } | { kind: "disk"; cx: number; cy: number; r: number; color: string }
  | { kind: "line"; x0: number; y0: number; x1: number; y1: number; w: number; color: string; ink?: string };
export type Shot = "wide" | "medium" | "close";
export type Audio = { kind: "fake-tts"; voice: string; at: number } | { kind: "silence" };
export type Scene = { id: string; version: number; beat: string; character: string; shot: Shot; line: string; audio: Audio; frames: number;
  dependsOn: string[]; home: number; face: 1 | -1; bg: string; props: Prop[]; acting: Key[]; shadow?: string };
export type Manifest = { v: 1; id: string; title: string; fps: number; assets: Record<string, Character>; scenes: Scene[] };
export type Format = "vertical" | "landscape";

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const HEX = /^#[0-9a-f]{6}$/i;

/** Problems with a manifest (empty = valid). */
export function manifestProblems(x: unknown): string[] {
  if (!isObj(x)) return ["manifest must be an object"];
  const out: string[] = [], m = x as Manifest;
  if (m.v !== MANIFEST_V) out.push(`v must be ${MANIFEST_V}`);
  if (m.fps !== FPS) out.push(`fps must be ${FPS}`);
  if (!isObj(m.assets)) return [...out, "assets must be an object"];
  for (const [id, a] of Object.entries(m.assets))
    if (a?.kind !== "character" || !HEX.test(a.color) || !(a.line > 0) || !(a.headR > 0)) out.push(`asset ${id}: needs kind character, a #rrggbb color, line and headR`);
  if (!Array.isArray(m.scenes) || m.scenes.length < 1 || m.scenes.length > 12) return [...out, "scenes must be a list of 1-12"];
  const ids = new Set<string>();
  for (const s of m.scenes) {
    const at = `scene ${s?.id ?? "?"}`;
    if (!isObj(s) || typeof s.id !== "string" || !/^[\w-]{1,32}$/.test(s.id)) { out.push("every scene needs an id (letters, digits, - or _)"); continue; }
    if (ids.has(s.id)) out.push(`${at}: duplicate id`);
    ids.add(s.id);
    if (!Number.isInteger(s.version) || s.version < 1) out.push(`${at}: version must be a whole number ≥ 1`);
    if (!Number.isInteger(s.frames) || s.frames < FPS) out.push(`${at}: frames must be a whole number ≥ ${FPS}`);
    if (!m.assets[s.character]) out.push(`${at}: unknown character ${s.character}`);
    if (!["wide", "medium", "close"].includes(s.shot)) out.push(`${at}: shot must be wide, medium or close`);
    if (typeof s.line !== "string" || s.line.length > 140) out.push(`${at}: line must be text up to 140 characters`);
    if (!HEX.test(s.bg)) out.push(`${at}: bg must be #rrggbb`);
    if (s.audio?.kind === "fake-tts") {
      if (!Number.isInteger(s.audio.at) || s.audio.at < 0) out.push(`${at}: audio.at must be a whole frame`);
      else if (s.line && s.audio.at + speechFrames(s.line) > s.frames - 15) out.push(`${at}: the line needs ${speechFrames(s.line)} frames from frame ${s.audio.at}, more than the scene leaves before its closing half-second`);
    } else if (s.audio?.kind !== "silence") out.push(`${at}: audio must be fake-tts or silence`);
    if (!Array.isArray(s.acting) || s.acting.length < 2) out.push(`${at}: acting needs at least 2 keys`);
    else for (const [i, k] of s.acting.entries()) {
      if (!Number.isInteger(k.f) || k.f < 0 || k.f > s.frames || (i && k.f <= s.acting[i - 1].f)) out.push(`${at}: key ${i} must be on a whole frame, inside the scene, after the previous key`);
    }
    if (!Array.isArray(s.dependsOn)) out.push(`${at}: dependsOn must be a list`);
  }
  for (const s of m.scenes) for (const d of s.dependsOn ?? []) if (!ids.has(d) && !m.assets[d]) out.push(`scene ${s.id}: depends on unknown ${d}`);
  if (!out.length && cycle(m)) out.push(`dependency cycle through ${cycle(m)}`);
  return out;
}
function cycle(m: Manifest): string {
  const by = new Map(m.scenes.map((s) => [s.id, s])), state = new Map<string, 1 | 2>();
  const visit = (id: string): string => {
    if (state.get(id) === 2 || !by.has(id)) return "";
    if (state.get(id) === 1) return id;
    state.set(id, 1);
    for (const d of by.get(id)!.dependsOn) { const c = visit(d); if (c) return c; }
    state.set(id, 2);
    return "";
  };
  for (const s of m.scenes) { const c = visit(s.id); if (c) return c; }
  return "";
}

// ---- hashing and invalidation ----

const canon = (x: unknown): unknown => Array.isArray(x) ? x.map(canon) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x;
export const sha = (x: unknown) => createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(canon(x))).digest("hex");

/** Input hash of every scene for one format: its own content (not `version`, so reverting an edit hits the cache again), its
 *  character sheet, the hashes of scenes/assets it depends on, the renderer version and the frame size. */
export function sceneHashes(m: Manifest, format: Format, scale = 1): Record<string, string> {
  const by = new Map(m.scenes.map((s) => [s.id, s])), out: Record<string, string> = {};
  const h = (id: string): string => {
    if (out[id]) return out[id];
    const { version: _v, ...s } = by.get(id)!;
    const deps = [...new Set([s.character, ...s.dependsOn])].sort().map((d) => [d, by.has(d) ? h(d) : sha(m.assets[d])]);
    return (out[id] = sha({ renderer: RENDERER, fps: m.fps, size: layout(format, scale).size, scene: s, deps }));
  };
  m.scenes.forEach((s) => h(s.id));
  return out;
}
/** The final join's input: the scenes' output hashes in order. */
export const assemblyHash = (format: Format, outputs: string[]) => sha({ renderer: RENDERER, format, outputs });

/** Scenes whose input hash changed between two builds (dependants follow automatically, their hash includes the dependency's). */
export const dirtyScenes = (before: Record<string, string>, after: Record<string, string>) => Object.keys(after).filter((id) => before[id] !== after[id]);

/** An edit to one scene: a new manifest with that scene's version bumped (earlier takes stay addressable by their hash). */
export function editScene(m: Manifest, id: string, patch: Partial<Omit<Scene, "id" | "version">>): Manifest {
  if (!m.scenes.some((s) => s.id === id)) throw new Error(`no scene ${id}`);
  return { ...m, scenes: m.scenes.map((s) => (s.id === id ? { ...s, ...patch, version: s.version + 1 } : s)) };
}

// ---- timeline, fake voice, captions ----

export const starts = (m: Manifest) => m.scenes.map((_, i) => m.scenes.slice(0, i).reduce((a, s) => a + s.frames, 0));
export const totalFrames = (m: Manifest) => m.scenes.reduce((a, s) => a + s.frames, 0);

type Span = { start: number; end: number; syl: number };
/** When each word of the fake voice sounds, in seconds from the line's start: longer words take longer, commas pause. */
export function wordSpans(line: string): Span[] {
  let t = 0;
  return line.split(/\s+/).filter(Boolean).map((w) => {
    const n = w.replace(/[^\p{L}\p{N}]/gu, "").length || 1, d = 0.14 + 0.05 * n, s = { start: t, end: t + d, syl: Math.max(1, Math.round(n / 3)) };
    t += d + (/[,;:]$/.test(w) ? 0.2 : /[.!?]$/.test(w) ? 0.3 : 0.07);
    return s;
  });
}
export const speechFrames = (line: string) => { const w = wordSpans(line); return w.length ? Math.ceil(w[w.length - 1].end * FPS) : 0; };
/** Loudness envelope 0..1 at t seconds into the line (also opens the stickman's mouth). */
export function envelope(spans: Span[], t: number): number {
  const s = spans.find((x) => t >= x.start && t < x.end);
  return s ? Math.abs(Math.sin(Math.PI * s.syl * ((t - s.start) / (s.end - s.start)))) ** 0.6 : 0;
}
/** Fake TTS: the scene's whole length as 48 kHz mono 16-bit WAV, a voiced tone shaped like the line's syllables from frame `at`. */
export function fakeVoiceWav(line: string, at: number, frames: number, voice: string): Uint8Array {
  const n = (frames * RATE) / FPS, b = new Uint8Array(44 + n * 2), v = new DataView(b.buffer), spans = wordSpans(line);
  const s = (o: number, t: string) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  s(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); s(8, "WAVE"); s(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, "data"); v.setUint32(40, n * 2, true);
  const base = 140 + (parseInt(sha(voice).slice(0, 4), 16) % 60), t0 = at / FPS;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE - t0, e = t >= 0 ? envelope(spans, t) : 0;
    ph += (2 * Math.PI * (base + 25 * Math.sin(2 * Math.PI * 0.7 * t))) / RATE;
    const x = e * 0.42 * (0.6 * Math.sin(ph) + 0.28 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph));
    v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x)) * 32767), true);
  }
  return b;
}

export type Cue = { scene: string; start: number; end: number; text: string; lines: string[] }; // frames, film timeline
/** One caption per spoken line: from the voice's first frame to a third of a second after it ends, never past its scene's cut. */
export function cues(m: Manifest, format: Format): Cue[] {
  const st = starts(m), L = layout(format);
  return m.scenes.flatMap((s, i) => {
    if (s.audio.kind !== "fake-tts" || !s.line.trim()) return [];
    const start = st[i] + s.audio.at, end = Math.min(st[i] + s.frames - 1, start + speechFrames(s.line) + 10);
    return [{ scene: s.id, start, end, text: s.line, lines: wrap(s.line, L.caption.maxChars) }];
  });
}
/** Greedy word wrap at maxChars (the renderer gets the same breaks, so the estimate below matches what is burned in). */
export function wrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (out.length && (out[out.length - 1] + " " + w).length <= maxChars) out[out.length - 1] += " " + w; else out.push(w);
  }
  return out;
}
/** ASS for one scene's burned-in caption, times relative to the scene. */
export function sceneAss(c: Cue | undefined, sceneStart: number, format: Format, scale = 1): string {
  const L = layout(format, scale), [w, h] = L.size;
  const ev = c ? [`Dialogue: 0,${assTime((c.start - sceneStart) / FPS)},${assTime((c.end + 1 - sceneStart) / FPS)},Cap,,0,0,0,,${c.lines.map(assText).join("\\N")}`] : [];
  return ["[Script Info]", "ScriptType: v4.00+", `PlayResX: ${w}`, `PlayResY: ${h}`, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "", "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,Liberation Sans,${Math.round(L.caption.size * scale)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,${Math.max(1, Math.round(4 * scale))},0,2,40,40,${Math.round(L.caption.marginV * scale)},1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ...ev, ""].join("\n");
}
const srtTime = (f: number) => { const ms = Math.round((f / FPS) * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
export const srt = (cs: Cue[]) => cs.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end + 1)}\n${c.lines.join("\n")}\n`).join("\n");

// ---- layout and safe zones (E05) ----

type Box = [number, number, number, number]; // x0, y0, x1, y1 in pixels
/** Frame size, where the 1000-unit stage sits, the caption style, and the safe zone: vertical keeps clear of the Shorts/Reels/TikTok
 *  UI (top 10 %, bottom 20 %, right-hand buttons 12 %, left 5 %); landscape uses 5 % title-safe margins. */
export function layout(format: Format, scale = 1) {
  const v = format === "vertical", size: [number, number] = v ? [1080, 1920] : [1920, 1080];
  const stage = v ? { s: 0.9, x: 54, y: 330 } : { s: 0.8, x: 560, y: 24 };
  const safe: Box = v ? [54, 192, 950, 1536] : [96, 54, 1824, 1026];
  const caption = v ? { size: 62, marginV: 420, maxChars: 24 } : { size: 54, marginV: 70, maxChars: 40 };
  return { size: size.map((n) => Math.round((n * scale) / 2) * 2) as [number, number], stage, safe, caption };
}
const ZOOM: Record<Shot, number> = { wide: 0.92, medium: 1, close: 1.15 };
/** Stage units → pixels for a scene's shot (close shots zoom in around the character's chest). */
export function stageToPx(s: Scene, format: Format, scale = 1) {
  const L = layout(format), z = ZOOM[s.shot], fx = s.home, fy = 640, k = L.stage.s * scale;
  return { k: k * z, to: (q: [number, number]): [number, number] => [(L.stage.x + (fx + (q[0] - fx) * z) * L.stage.s) * scale, (L.stage.y + (fy + (q[1] - fy) * z) * L.stage.s) * scale] };
}
/** Pixel box of a caption's estimated text block (shortcut: assumes 0.55 em average glyph width; measure with libass if a font change makes it drift). */
export function captionBox(c: Cue, format: Format): Box {
  const L = layout(format), [w, h] = L.size, lw = Math.max(...c.lines.map((l) => l.length)) * L.caption.size * 0.55, lh = c.lines.length * L.caption.size * 1.2;
  return [(w - lw) / 2, h - L.caption.marginV - lh, (w + lw) / 2, h - L.caption.marginV];
}
/** Union pixel box of the character over frames [a, b] of a scene. */
export function actorBox(m: Manifest, s: Scene, format: Format, a = 0, b = s.frames - 1): Box {
  const ch = m.assets[s.character], { to } = stageToPx(s, format);
  let box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let f = a; f <= b; f++) {
    const [x0, y0, x1, y1] = rigBox(rig(sample(s.acting, f), s.home, s.face, ch.headR), ch.line), p0 = to([x0, y0]), p1 = to([x1, y1]);
    box = [Math.min(box[0], p0[0]), Math.min(box[1], p0[1]), Math.max(box[2], p1[0]), Math.max(box[3], p1[1])];
  }
  return box;
}
const inside = (a: Box, b: Box) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const r0 = (b: Box) => b.map(Math.round);

// ---- export preflight (E07) ----

export type Probe = { duration: number; width: number; height: number; fps: string; frames: number; audioStreams: number; meanDb: number | null; maxDb: number | null };
export type Check = { id: string; ok: boolean; detail: string };
export const LIMITS = { sec: [15, 25], meanDb: [-30, -12], maxDb: -1 } as const;

/** Every check for one exported format. `probe` comes from ffprobe + volumedetect on the final file; `missing` lists files the
 *  render expected but did not find (scene outputs, captions). Pure, so a failing control can be built by hand. */
export function preflight(m: Manifest, format: Format, probe: Probe, missing: string[] = []): { ok: boolean; checks: Check[] } {
  const L = layout(format), frames = totalFrames(m), cs = cues(m, format), st = starts(m), checks: Check[] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });
  const problems = manifestProblems(m);
  add("manifest", !problems.length, problems.join("; ") || `v${m.v}, ${m.scenes.length} scenes, ${m.scenes.map((s) => `${s.id}@v${s.version}`).join(" ")}`);
  add("duration", Math.abs(probe.duration - frames / FPS) <= 1 / FPS && frames / FPS >= LIMITS.sec[0] && frames / FPS <= LIMITS.sec[1],
    `${probe.duration.toFixed(3)} s, manifest ${frames} frames = ${(frames / FPS).toFixed(3)} s (allowed ${LIMITS.sec.join("-")} s)`);
  add("frames", probe.frames === frames, `${probe.frames} frames in file, ${frames} in manifest (cuts at ${st.slice(1).join(", ")})`);
  add("resolution", probe.width === L.size[0] && probe.height === L.size[1], `${probe.width}x${probe.height}, expected ${L.size.join("x")}`);
  add("fps", probe.fps === `${FPS}/1`, `${probe.fps}, expected ${FPS}/1`);
  add("audio-stream", probe.audioStreams >= 1, `${probe.audioStreams} audio stream(s)`);
  add("audio-level", probe.meanDb !== null && probe.maxDb !== null && probe.meanDb >= LIMITS.meanDb[0] && probe.meanDb <= LIMITS.meanDb[1] && probe.maxDb <= LIMITS.maxDb,
    `mean ${probe.meanDb} dB, peak ${probe.maxDb} dBFS (want mean ${LIMITS.meanDb.join("..")} dB, peak ≤ ${LIMITS.maxDb})`);
  const spoken = m.scenes.filter((s) => s.audio.kind === "fake-tts" && s.line.trim()).length;
  add("captions-present", cs.length === spoken && cs.length > 0, `${cs.length} caption(s) for ${spoken} spoken line(s)`);
  const clash = cs.slice(1).map((c, i) => [cs[i], c]).filter(([a, b]) => a.end >= b.start);
  const spill = cs.filter((c) => { const i = m.scenes.findIndex((s) => s.id === c.scene); return c.start < st[i] || c.end >= st[i] + m.scenes[i].frames; });
  add("captions-no-overlap", !clash.length && !spill.length, [...clash.map(([a, b]) => `${a.scene} ends ${a.end} ≥ ${b.scene} starts ${b.start}`), ...spill.map((c) => `${c.scene} crosses its cut`)].join("; ") || "no overlaps, none crosses a cut");
  const capOut = cs.filter((c) => !inside(captionBox(c, format), L.safe));
  add("safe-captions", !capOut.length, capOut.map((c) => `${c.scene} caption ${r0(captionBox(c, format))} outside safe ${L.safe}`).join("; ") || `all captions inside safe ${L.safe}`);
  const actOut = m.scenes.filter((s) => !inside(actorBox(m, s, format), L.safe));
  add("safe-actor", !actOut.length, actOut.map((s) => `${s.id} actor ${r0(actorBox(m, s, format))} outside safe ${L.safe}`).join("; ") || "the character stays inside the safe zone in every frame");
  const covered = cs.filter((c) => { const i = m.scenes.findIndex((s) => s.id === c.scene); return overlaps(captionBox(c, format), actorBox(m, m.scenes[i], format, c.start - st[i], c.end - st[i])); });
  add("captions-clear-of-actor", !covered.length, covered.map((c) => `${c.scene} caption covers the character`).join("; ") || "no caption covers the character");
  const acting = m.scenes.map((s) => [s.id, actingReport(s.acting, s.frames)] as [string, Acting]);
  add("acting", acting.every(([, a]) => a.ok), acting.map(([id, a]) => `${id}: ${a.anticipations} anticipation, ${a.holds} hold, ${a.linearBig} linear big move${a.offFrame.length ? `, off-frame keys ${a.offFrame}` : ""}`).join("; "));
  add("assets", !missing.length && m.scenes.every((s) => m.assets[s.character]), missing.length ? `missing: ${missing.join(", ")}` : "every character sheet and scene output found");
  return { ok: checks.every((c) => c.ok), checks };
}
export type { Pose, Key };
