// Planet pages, one pattern everywhere (owner 21 Nov: "I have a problem → ORBIT fixes it → I can see the progress"):
// what it's for → one box to say what you need → "Working on it" cards → results → More. This file turns each planet's own job
// state into the shared Progress model (progress-pure.ts) in plain words, and keeps internal names off the default screens.
// Pure; tests in tests/planet-page.test.ts. Cards never approve anything: their button opens where the item's own Approve lives.
import type { Lang } from "./i18n-pure.ts";
import { fromStages, sortProgress, type Progress } from "./progress-pure.ts";

const STAGE_WORDS = {
  clip: {
    en: ["Reading the video", "Writing down what's said", "Finding the best moments", "Making the Shorts"],
    et: ["Loen videot", "Kirjutan üles, mida räägitakse", "Otsin parimaid hetki", "Teen Shortse"],
  },
  download: { en: ["Downloading the video", "Getting it ready"], et: ["Laadin video alla", "Valmistan ette"] },
  brief: { en: ["Reading the news", "Writing your briefing"], et: ["Loen uudiseid", "Kirjutan sinu ülevaadet"] },
} as const;

const W = {
  en: {
    clipTitle: (src: string) => `Shorts from ${src}`, dlTitle: (src: string) => `Getting ${src}`, briefTitle: "Today's briefing",
    clipsDone: (n: number) => (n === 1 ? "Made 1 Short. Next: watch it and approve or skip it." : `Made ${n} Shorts. Next: watch them and approve or skip.`),
    clipsNone: "No good moments found. Try a longer video or another part of the stream.",
    review: "Review", see: "Open", dlDone: "Downloaded. Making Shorts from it next.", briefDone: "Your briefing is ready. Next: read it.",
  },
  et: {
    clipTitle: (src: string) => `Shortsid: ${src}`, dlTitle: (src: string) => `Laadin: ${src}`, briefTitle: "Tänane ülevaade",
    clipsDone: (n: number) => (n === 1 ? "Tegin 1 Shorti. Edasi: vaata see üle ja kinnita või jäta vahele." : `Tegin ${n} Shortsi. Edasi: vaata need üle ja kinnita või jäta vahele.`),
    clipsNone: "Häid hetki ei leidnud. Proovi pikemat videot või striimi teist osa.",
    review: "Vaata üle", see: "Ava", dlDone: "Alla laaditud. Teen sellest järgmiseks Shortsid.", briefDone: "Sinu ülevaade on valmis. Edasi: loe see läbi.",
  },
} as const;
export const pageWords = (lang: Lang) => W[lang];

/** A file path or URL → a short name a person recognises ("stream-0412.mp4", "youtube.com/watch…"). */
export function shortSource(src: string, max = 40): string {
  const s = (src || "").trim();
  let name = s;
  try { if (/^https?:\/\//i.test(s)) { const u = new URL(s); name = u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? u.pathname.slice(0, 12) + "…" : ""); } }
  catch { /* not a URL */ }
  if (name === s) name = s.split(/[\\/]/).filter(Boolean).pop() ?? s;
  return name.length > max ? `${name.slice(0, max - 1)}…` : name || "a video";
}

const DAY = 86_400_000;
const CLIP_STAGE: Record<string, number> = { queued: -1, probing: 0, transcribing: 1, finding: 2, rendering: 3, done: 4, failed: -2 };
/** How long one stage of a clip job usually takes, for "about X min left" (rough: a 1-hour stream on the RTX 5060). */
const CLIP_TYPICAL_MS = 12 * 60_000;

export type ClipJobLike = { id: string; source: string; createdAt: string; updatedAt: string; status: string; progress?: number; step?: string; error?: string;
  clips?: { id: string; status: string }[] };
export type DownloadLike = { id: string; url: string; status: string; progress?: number; step?: string; error?: string; createdAt: string };

/** STUDIO clip jobs + downloads → "Working on it" cards: everything still running, plus what finished or failed in the last day. */
export function studioWork(jobs: ClipJobLike[], downloads: DownloadLike[], lang: Lang, nowMs: number): Progress[] {
  const w = W[lang], out: Progress[] = [];
  for (const j of jobs) {
    const st = CLIP_STAGE[j.status] ?? -1;
    const recent = nowMs - (Date.parse(j.updatedAt) || 0) < DAY;
    if ((j.status === "done" || j.status === "failed") && !recent) continue;
    const ready = (j.clips ?? []).filter((c) => c.status === "ready");
    const made = (j.clips ?? []).filter((c) => c.status !== "failed" && c.status !== "rejected").length;
    const done = j.status === "done";
    const failedAt = j.status === "failed" ? Math.max(0, Math.min(3, Math.round((j.progress ?? 0) * 3))) : 0;
    out.push(fromStages({
      id: `clip:${j.id}`, title: w.clipTitle(shortSource(j.source)), stages: [...STAGE_WORDS.clip[lang]],
      current: j.status === "failed" ? failedAt : st === -2 ? 0 : st, failed: j.status === "failed", error: j.error ? plainError(j.error, lang) : undefined,
      startedAt: j.createdAt, typicalMs: CLIP_TYPICAL_MS, at: j.updatedAt,
      result: done ? { text: made ? w.clipsDone(made) : w.clipsNone, ...(ready[0] && { open: `#o=studio&k=review&id=${encodeURIComponent(ready[0].id)}` }) } : null,
      needs: done && ready[0] ? { kind: "open", label: w.review, open: `#o=studio&k=review&id=${encodeURIComponent(ready[0].id)}` } : null,
    }, lang, nowMs));
  }
  for (const d of downloads) {
    if (d.status === "done" || (d.status === "failed" && nowMs - (Date.parse(d.createdAt) || 0) > DAY)) continue;
    out.push(fromStages({ id: `dl:${d.id}`, title: w.dlTitle(shortSource(d.url)), stages: [...STAGE_WORDS.download[lang]],
      current: d.status === "queued" ? -1 : 0, failed: d.status === "failed", error: d.error ? plainError(d.error, lang) : undefined,
      startedAt: d.createdAt, typicalMs: 5 * 60_000, at: d.createdAt }, lang, nowMs));
  }
  // A finished job that only waits for review isn't "needs" by itself (the review lives in Needs you); keep it as done with a button.
  return sortProgress(out.map((p) => (p.phase === "needs" ? { ...p, phase: "done" as const } : p)));
}

/** INTELLIGENCE: the briefing job (GET /api/briefings job row) → one card while it runs or right after. */
export function briefingWork(job: { status: string; detail?: string | null; started_at: string; finished_at?: string | null } | null, lang: Lang, nowMs: number): Progress[] {
  if (!job) return [];
  const end = Date.parse(job.finished_at ?? "");
  if (job.status !== "running" && (!Number.isFinite(end) || nowMs - end > 6 * 3_600_000)) return [];
  const w = W[lang], failed = job.status === "failed" || job.status === "error";
  return [fromStages({ id: "brief", title: w.briefTitle, stages: [...STAGE_WORDS.brief[lang]], current: job.status === "running" ? (/writ|draft|summar/i.test(job.detail ?? "") ? 1 : 0) : failed ? 1 : 2,
    failed, error: failed ? plainError(job.detail ?? "", lang) : undefined, startedAt: job.started_at, typicalMs: 3 * 60_000, at: job.finished_at || job.started_at,
    result: !failed && job.status !== "running" ? { text: w.briefDone } : null }, lang, nowMs)];
}

// Internal names that leak into default screens → plain words. Applied to error/status lines we don't write ourselves.
const PLAIN: [RegExp, { en: string; et: string }][] = [
  [/\bgpu lease\b|\blease\b/gi, { en: "the graphics card is busy", et: "graafikakaart on hõivatud" }],
  [/\bpacer\b/gi, { en: "the daily AI limit", et: "päevane tehisaru piir" }],
  [/\bscout\b/gi, { en: "video finder", et: "videootsija" }],
  [/\breceipts?\b/gi, { en: "record", et: "kirje" }],
  [/\bENOENT\b|\bno such file\b/gi, { en: "a file is missing", et: "fail on puudu" }],
  [/\bETIMEDOUT\b|\btimed? ?out\b/gi, { en: "it took too long", et: "see võttis liiga kaua" }],
  [/\bECONNREFUSED\b/gi, { en: "a helper program isn't running", et: "abiprogramm ei tööta" }],
];
/** One short, plain line for an error: first sentence, internal words swapped, no stack traces or paths. */
export function plainError(msg: string, lang: Lang): string {
  let s = (msg || "").split("\n")[0].replace(/\s+at\s+\S+\s*\(.*$/, "").replace(/[A-Z]:\\[^\s"']+|\/(?:home|tmp|usr)\/[^\s"']+/g, "a file").trim();
  for (const [re, w] of PLAIN) s = s.replace(re, w[lang]);
  s = s.length > 140 ? `${s.slice(0, 139)}…` : s;
  return s || (lang === "et" ? "Ei õnnestunud." : "Didn't work.");
}

/** Example asks for "More": the planet's three, skipping empty ones. */
export const examples = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean).slice(0, 3);
