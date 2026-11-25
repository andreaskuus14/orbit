// ARCH photo scan, pure part (IO: photo-scan.ts; route: /api/arch/photo-scan; tests: tests/photo-scan.test.ts).
// 3-10 photos of a room, a facade or an object → Local AI's /photo-scan (tools/local-ai/photo_scan.py: Depth Anything 3 BASE,
// Apache-2.0) → a 3DGS-layout .ply in VAULT → ARCH's splat viewer opens it and its measure tool sets the size from one known length.
// Progress shows on the shared "Working on it" card. The photos never leave this PC (the service is loopback-only).
import { fromStages, type Progress } from "./progress-pure.ts";
import type { Lang } from "./i18n-core-pure.ts";

export const MIN_PHOTOS = 3;
export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // server.py MAX_IMAGE
export const TYPICAL_MS = 90_000; // model load + 10 photos; GPU is faster, CPU about this (measured on a 2-core cloud CPU: 8 photos 27 s)
const PHOTO_NAME = /\.(jpe?g|png|webp)$/i;

export type PhotoIn = { name: string; bytes: number };
/** "" when the set can go to the model, else one plain sentence. */
export function checkPhotos(list: PhotoIn[]): string {
  if (list.length < MIN_PHOTOS) return `Add more photos: at least ${MIN_PHOTOS}, walking around the room or object.`;
  if (list.length > MAX_PHOTOS) return `Too many photos: pick the best ${MAX_PHOTOS}.`;
  const bad = list.find((p) => !PHOTO_NAME.test(p.name));
  if (bad) return `${bad.name.slice(0, 60)}: use JPG, PNG or WebP photos.`;
  const big = list.find((p) => p.bytes > MAX_PHOTO_BYTES);
  if (big) return `${big.name.slice(0, 60)} is too big (max 15 MB a photo).`;
  if (list.some((p) => p.bytes <= 0)) return "One of the photos is empty.";
  return "";
}

/** VAULT name for the result: photo-scan-<what>-YYYY-MM-DD.ply (VAULT adds -2, -3… when it is taken). */
export function scanFileName(what: string, isoDate: string): string {
  const slug = what.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `photo-scan-${slug || "scan"}-${isoDate.slice(0, 10)}.ply`;
}

export type ScanReport = { views: number; points: number; kept: number; size: [number, number, number]; device: string };
/** server.py's x-orbit-report header → checked report; null when missing or odd. */
export function parseReport(raw: string | null): ScanReport | null {
  try {
    const j = JSON.parse(raw ?? "") as Record<string, unknown>;
    const size = Array.isArray(j.size) && j.size.length === 3 && j.size.every((v) => typeof v === "number" && Number.isFinite(v)) ? (j.size as [number, number, number]) : null;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
    const views = n(j.views), points = n(j.points), kept = n(j.kept);
    if (views === null || points === null || kept === null || !size) return null;
    return { views, points, kept, size, device: j.device === "GPU" ? "GPU" : "CPU" };
  } catch { return null; }
}

/** MEMORY note: the `vault:` line is how ARCH's library reopens it (arch-studio-pure scanVaultName); tags make it a scan. */
export function photoScanNote(m: { title: string; vault: string; photos: number; report: ScanReport }): { title: string; content: string; tags: string[] } {
  return {
    title: `Scan: ${m.title || "photo scan"}`.slice(0, 300),
    content: [
      `Photo scan made in ARCH from ${m.photos} photos with Depth Anything 3 BASE (Apache-2.0), on this PC (${m.report.device}).`,
      `vault: ${m.vault}`,
      `splats: ${m.report.points.toLocaleString("en")} points (${Math.round(m.report.kept * 100)}% of the pixels were sure enough to keep)`,
      `extent: ${m.report.size.map((v) => v.toFixed(2)).join(" × ")} (model units, not metres until calibrated on one known length)`,
    ].join("\n"),
    tags: ["arch", "scan", "photo-scan"],
  };
}

// ---------- the job and its progress card ----------

export type ScanStage = "read" | "gpu" | "build" | "save" | "size";
export const STAGES: ScanStage[] = ["read", "gpu", "build", "save", "size"];
export type ScanJob = {
  id: string; title: string; photos: number; stage: ScanStage | "done"; startedAt: string; at: string;
  wait?: string; error?: string; saved?: string; noteId?: string; report?: ScanReport;
};

const WORDS = {
  en: { title: (t: string) => `3D scan: ${t}`, read: "Reading the photos", gpu: "Waiting for the graphics card", build: "Building the 3D points",
    save: "Saving to VAULT", size: "Set the size", open: "Open and set the size",
    ready: (n: number, f: string) => `${n.toLocaleString("en")} points saved as ${f}. Open it, click both ends of something you know (a door: top and bottom) and type its real length.` },
  et: { title: (t: string) => `3D-skaneering: ${t}`, read: "Loen fotosid", gpu: "Ootan graafikakaarti", build: "Teen 3D-punkte",
    save: "Salvestan VAULTi", size: "Määra suurus", open: "Ava ja määra suurus",
    ready: (n: number, f: string) => `${n.toLocaleString("en")} punkti salvestatud failina ${f}. Ava see, klõpsa millegi tuntud asja mõlemale otsale (uks: üleval ja all) ja kirjuta selle päris pikkus.` },
} as const;
export const stageWords = (lang: Lang) => STAGES.map((s) => WORDS[lang][s]);

/** The job on the shared card. Done = the last step ("Set the size") waits for him, with one Open button. */
export function scanProgress(j: ScanJob, lang: Lang, nowMs: number): Progress {
  const w = WORDS[lang], idx = j.stage === "done" ? STAGES.indexOf("size") : STAGES.indexOf(j.stage);
  const done = j.stage === "done";
  return fromStages({
    id: `photo-scan:${j.id}`, title: w.title(j.title), stages: stageWords(lang), current: idx, failed: !!j.error, error: j.error,
    now: j.stage === "gpu" && j.wait ? j.wait : null, startedAt: j.startedAt, typicalMs: TYPICAL_MS,
    result: done && j.saved && j.report ? { text: w.ready(j.report.points, j.saved) } : null,
    needs: done && j.saved ? { kind: "open", label: w.open, open: `#o=arch&scan=${encodeURIComponent(j.saved)}` } : null, at: j.at,
  }, lang, nowMs);
}

/** Keep the newest few jobs (the card list), dropping finished ones older than a day. */
export const pruneJobs = (jobs: ScanJob[], nowMs: number) =>
  jobs.filter((j) => (j.stage !== "done" && !j.error) || nowMs - Date.parse(j.at) < 86_400_000).slice(-5);
