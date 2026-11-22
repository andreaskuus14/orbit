// ARCH → Render in Blender (pure, tested in tests/arch-render.test.ts). IO: arch-render.ts; route: /api/arch/render; UI: ArchRender.tsx.
// Owner (22 Nov 2026): "always use Blender, it's free". The saved ARCH model goes through arch-blender-pure's script (real sun for the
// site and time, straight verticals, physically based materials) and Blender renders it with Cycles on this PC, in the background.
// Nothing is uploaded: the picture lands in VAULT. The scene is re-checked here before it becomes Python: only known part kinds and
// finite numbers survive, so nothing stored in the model can reach the script as code.
import { FACES, GROUPS, KINDS, ROOF_FORMS, styleOf, type Part, type Scene } from "./arch-pure.ts";
import type { Quality } from "./arch-blender-pure.ts";
import type { Lang } from "./i18n-pure.ts";
import { minutesLeft, stepsFrom, words, type Progress } from "./progress-pure.ts";

export type RenderStage = "script" | "gpu" | "render" | "save";
export type RenderJob = {
  id: string; quality: Quality; stage: RenderStage | "done"; startedAt: string; at: string;
  wait?: string; error?: string; saved?: string; seconds?: number;
};

const KIND = new Set<string>(KINDS), FACE = new Set<string>(FACES);
const NUM = ["x", "y", "z", "w", "d", "h"] as const;
const OPT_NUM = ["off", "sill"] as const;

/** The parts Blender may build: known kinds, finite sizes (|v| ≤ 500 m), text capped. Anything else is dropped, not repaired. */
export function cleanScene(scene: unknown): Scene | null {
  const parts = (scene as { parts?: unknown })?.parts;
  if (!Array.isArray(parts)) return null;
  const ok: Part[] = [];
  for (const raw of parts.slice(0, 2000)) {
    const p = raw as Record<string, unknown>;
    if (!p || typeof p !== "object" || typeof p.id !== "string" || !KIND.has(p.kind as string)) continue;
    if (!NUM.every((k) => typeof p[k] === "number" && Number.isFinite(p[k]) && Math.abs(p[k] as number) <= 500)) continue;
    if (!OPT_NUM.every((k) => p[k] === undefined || (typeof p[k] === "number" && Number.isFinite(p[k])))) continue;
    if (p.face !== undefined && !FACE.has(p.face as string)) continue;
    ok.push({
      ...(Object.fromEntries([...NUM, ...OPT_NUM].filter((k) => p[k] !== undefined).map((k) => [k, p[k]])) as Pick<Part, (typeof NUM)[number]>),
      id: p.id.slice(0, 64), kind: p.kind as Part["kind"], name: typeof p.name === "string" ? p.name.slice(0, 80) : String(p.kind),
      ...(typeof p.host === "string" && { host: p.host.slice(0, 64) }), ...(p.face !== undefined && { face: p.face as Part["face"] }),
      ...((GROUPS as readonly unknown[]).includes(p.group) && { group: p.group as Part["group"] }),
      ...((ROOF_FORMS as readonly unknown[]).includes(p.roof) && { roof: p.roof as Part["roof"] }),
      ...(typeof p.pitch === "number" && Number.isFinite(p.pitch) && p.pitch >= 0 && p.pitch <= 60 && { pitch: p.pitch }),
      ...((p.ridge === "x" || p.ridge === "z") && { ridge: p.ridge }),
    });
  }
  const s = scene as Partial<Scene>, plot = s.plot && typeof s.plot === "object" ? s.plot : null;
  return ok.length ? { ...(s as object), parts: ok, style: styleOf(s), ...(plot && { plot }) } as Scene : null;
}

/** Where Blender is. BLENDER_PATH wins; then the newest "Blender Foundation\Blender x.y\blender.exe" found; then "blender" on PATH. */
export function pickBlender(env: string | undefined, installed: string[]): string {
  if (env?.trim()) return env.trim();
  const ver = (p: string) => (p.match(/Blender (\d+)\.(\d+)/i) ?? []).slice(1).map(Number);
  const best = [...installed].filter((p) => /blender\.exe$/i.test(p)).sort((a, b) => {
    const [a1 = 0, a2 = 0] = ver(a), [b1 = 0, b2 = 0] = ver(b);
    return b1 - a1 || b2 - a2;
  })[0];
  return best ?? "blender";
}

/** blender -b -P <script> -- <out.png>: background, no UI, the script reads its output path after "--". */
export const blenderArgs = (script: string, out: string) => ["-b", "--factory-startup", "-P", script, "--", out];

/** A preview is quick; a detail render may take a while on a laptop GPU. */
export const TIMEOUT_MS: Record<Quality, number> = { preview: 6 * 60_000, detail: 30 * 60_000 };

export const renderFileName = (q: Quality, at: string) => `arch-render-${q}-${at.slice(0, 19).replace(/[:T]/g, "-")}.png`;

/** Lat/lon/time from the browser: numbers in range, else the defaults (Tallinn, now). */
export function renderSite(b: { lat?: unknown; lon?: unknown; at?: unknown }, now: Date): { lat: number; lon: number; date: Date } {
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : d);
  const t = typeof b.at === "string" ? new Date(b.at) : now;
  return { lat: n(b.lat, -90, 90, 59.437), lon: n(b.lon, -180, 180, 24.7536), date: Number.isFinite(t.getTime()) ? t : now };
}

/** The plain-words reason for a Blender failure (the raw tail stays in the server log). */
export function blenderError(code: string | number | null | undefined, out: string): string {
  if (code === "ENOENT") return "Blender isn't installed (or not found). Install it free from blender.org, or set BLENDER_PATH in .env.local to blender.exe.";
  if (code === "ETIMEDOUT" || /timed? ?out/i.test(String(code))) return "Blender took too long. Try a Preview render first.";
  if (/out of memory|CUDA error|OPTIX|failed to allocate/i.test(out)) return "The graphics card ran out of memory. Try a Preview render, or close other GPU work.";
  return "Blender stopped with an error. The details are in ORBIT's log.";
}

export const pruneJobs = (jobs: RenderJob[], now: number) =>
  jobs.filter((j) => j.stage !== "done" && !j.error ? true : now - Date.parse(j.at) < 6 * 3600_000).slice(-6);

export const STAGE_TEXT: Record<RenderStage, string> = {
  script: "Writing the Blender scene", gpu: "Waiting for the graphics card", render: "Blender is rendering", save: "Saving to VAULT",
};

// ---------- Blender found or not, in plain words, and the render on the shared "Working on it" card ----------
export type BlenderInfo = { found: boolean; bin: string; how: "env" | "installed" | "path" | "none" };
/** Where Blender is and whether it's really there: BLENDER_PATH (if the file exists), an installed version, or blender on PATH. */
export function findBlender(env: string | undefined, installed: string[], onPath: string | null, exists: (f: string) => boolean): BlenderInfo {
  if (env?.trim() && exists(env.trim())) return { found: true, bin: env.trim(), how: "env" };
  const best = pickBlender(undefined, installed);
  if (best !== "blender") return { found: true, bin: best, how: "installed" };
  if (onPath) return { found: true, bin: onPath, how: "path" };
  return { found: false, bin: "blender", how: "none" };
}
export const WINGET_BLENDER = "winget install BlenderFoundation.Blender";
export function blenderStatusText(b: Pick<BlenderInfo, "found"> | null, lang: Lang): string {
  if (!b) return lang === "et" ? "Kontrollin, kas Blender on olemas…" : "Checking for Blender…";
  if (b.found) return lang === "et" ? "Blender on olemas. Pilt tehakse selles arvutis, tasuta." : "Blender found. The picture is made on this PC, free.";
  return lang === "et" ? `Blenderit pole. Paigalda tasuta: ${WINGET_BLENDER}` : `Blender isn't installed. Install it free: ${WINGET_BLENDER}`;
}
/** Typical time per quality on the laptop GPU (the owner's preview took 28 s), for "about X min left". */
export const RENDER_MS: Record<Quality, number> = { preview: 45_000, detail: 8 * 60_000 };
const STAGES: RenderStage[] = ["script", "gpu", "render", "save"];
const STAGE_ET: Record<RenderStage, string> = { script: "Kirjutan Blenderi stseeni", gpu: "Ootan graafikakaarti", render: "Blender renderdab", save: "Salvestan VAULTi" };
/** One render job → the shared progress card. open: the picture in VAULT once it's there. */
export function renderProgress(job: RenderJob, lang: Lang, nowMs: number, open = ""): Progress {
  const labels = STAGES.map((s) => (lang === "et" ? STAGE_ET[s] : STAGE_TEXT[s])), w = words(lang);
  const done = job.stage === "done", i = done ? labels.length : STAGES.indexOf(job.stage as RenderStage);
  const title = lang === "et" ? (job.quality === "detail" ? "Blenderi detailpilt" : "Blenderi eelvaade") : (job.quality === "detail" ? "Blender detail render" : "Blender preview render");
  return {
    id: `arch-render-${job.id}`, title, phase: job.error ? "failed" : done ? "done" : job.wait ? "waiting" : "working",
    steps: stepsFrom(labels, i, !!job.error), now: job.error || done ? null : job.wait ?? labels[i],
    leftMin: job.error || done ? null : minutesLeft(job.startedAt, nowMs, RENDER_MS[job.quality]),
    result: job.error ? { text: job.error } : done ? { text: lang === "et" ? `Salvestatud VAULTi: ${job.saved ?? ""}${job.seconds ? ` · ${job.seconds} s` : ""}` : `Saved to VAULT as ${job.saved ?? ""}${job.seconds ? ` · ${job.seconds} s` : ""}`, open } : null,
    action: job.error ? { kind: "retry", label: w.retry, open: "" } : done && open ? { kind: "open", label: w.open, open } : null,
    at: job.at,
  };
}
