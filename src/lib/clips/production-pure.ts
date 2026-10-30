// STUDIO production record (STU01-04, pure; tested in tests/production.test.ts). One record per clip, joining what ORBIT already keeps:
// Idea Radar idea + AI Story script (story.clipJob), the source and its rights basis (job.rights), edit settings (clip.edit / job.options),
// render revisions (the clip and its "another version" renders), review (approval stamp), publication (clip.publish) and results (videoId).
// Nothing here publishes: it only says what is missing. The one publish point stays factory.startPublish after the owner's click.
import type { Clip, ClipJob } from "./types.ts";
import { RECAP_SOURCE, originalityIssue, ownSource } from "./publish-checks-pure.ts";

// ---- STU02: source rights ----
export const RIGHTS_BASES = ["own", "licensed", "written-permission", "creative-commons", "public-domain"] as const;
export type RightsBasis = (typeof RIGHTS_BASES)[number];
export type SourceRights = { basis: RightsBasis; evidence: string; at: string };
export const EVIDENCE_MIN = 10, EVIDENCE_MAX = 300;
const AI_STORY = "AI story: "; // story.ts: its clips are ORBIT's own generated video

/** A link or "it's public / I downloaded it" says where the video is, not who allowed its reuse. */
export function notPermission(evidence: string): boolean {
  const s = evidence.trim();
  return /^(https?:\/\/|www\.)\S*$/i.test(s) || /^(it'?s |it is )?(public(ly available)?|downloaded|on youtube|from youtube|available online|free to watch)\.?$/i.test(s);
}

/** Validates a rights body from the owner; returns the stored value or why it's refused. */
export function cleanRights(b: unknown, now = new Date().toISOString()): SourceRights | string {
  const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  if (!RIGHTS_BASES.includes(o.basis as RightsBasis)) return `basis must be one of ${RIGHTS_BASES.join(", ")}`;
  const evidence = typeof o.evidence === "string" ? o.evidence.replace(/[\x00-\x1f\x7f<>]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (evidence.length > EVIDENCE_MAX) return `evidence must be at most ${EVIDENCE_MAX} characters`;
  if (o.basis !== "own" && evidence.length < EVIDENCE_MIN) return "Say who allowed it and how (licence, message, email date)";
  if (o.basis !== "own" && notPermission(evidence)) return "A public link or a download is not permission: say who allowed it and how";
  return { basis: o.basis as RightsBasis, evidence, at: now };
}

/** Why this source isn't cleared for publishing, or null. Own footage (devlog, AI story) needs no basis. */
export function rightsProblem(job: Pick<ClipJob, "options" | "source"> & { rights?: SourceRights }): string | null {
  if (job.source.startsWith(RECAP_SOURCE)) return "ORBIT's private daily recap is never posted";
  if (ownSource(job) || job.source.startsWith(AI_STORY)) return null;
  const r = job.rights;
  if (!r || !RIGHTS_BASES.includes(r.basis)) return "No permission basis recorded for this source. A public link or a download is not permission.";
  if (r.basis !== "own" && (r.evidence.trim().length < EVIDENCE_MIN || notPermission(r.evidence))) return "The permission evidence for this source is missing or is only a link.";
  return null;
}

// ---- STU04: media checks (one ffmpeg decode pass; ffmpeg is what the factory already uses) ----
export type MediaCheck = { at: string; media?: string; pass: boolean; blocking: string[]; warnings: string[]; unchecked: string[]; evidence: string[];
  facts: { duration?: number; width?: number; height?: number; audio: boolean; meanDb?: number; maxDb?: number } };

/** ffmpeg args: decode everything, detect black and frozen stretches, measure loudness. Output to null; the log is on stderr. */
export const mediaCheckArgs = (file: string) => ["-hide_banner", "-nostdin", "-v", "info", "-i", file,
  "-vf", "blackdetect=d=0.5:pix_th=0.10,freezedetect=n=0.003:d=2", "-af", "volumedetect", "-f", "null", "-"];

const num = (s?: string) => (s === undefined ? undefined : Number(s));
/** Reads the ffmpeg log into a verdict. A technical pass only means the file plays as a Short; it says nothing about whether it's engaging. */
export function mediaVerdict(log: string, expect: { seconds?: number; captions?: boolean } = {}, at = new Date().toISOString()): MediaCheck {
  const blocking: string[] = [], warnings: string[] = [], evidence: string[] = [];
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  const duration = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : undefined;
  const v = /Stream #\d+:\d+[^\n]*: Video: [^\n]*?(\d{2,5})x(\d{2,5})/.exec(log);
  const width = num(v?.[1]), height = num(v?.[2]);
  const audio = /Stream #\d+:\d+[^\n]*: Audio:/.test(log);
  const meanDb = num(/mean_volume: (-?[\d.]+) dB/.exec(log)?.[1]), maxDb = num(/max_volume: (-?[\d.]+) dB/.exec(log)?.[1]);
  const errs = log.split("\n").filter((l) => /invalid data found|error while decoding|corrupt|moov atom not found|truncat|non-existing PPS|concealing/i.test(l));
  if (errs.length) { blocking.push("The render has decode errors (corrupt or truncated file)"); evidence.push(...errs.slice(0, 3).map((l) => l.trim().slice(0, 160))); }
  if (!v) { blocking.push("No playable video stream"); }
  if (!(duration! > 0)) blocking.push("No playable duration");
  else {
    if (duration! < 3) blocking.push(`Only ${duration!.toFixed(1)} s long`);
    if (duration! > 180) blocking.push(`${Math.round(duration!)} s is longer than a Short may be (3 min)`);
    if (expect.seconds && Math.abs(duration! - expect.seconds) > Math.max(2, expect.seconds * 0.25)) warnings.push(`Plays ${duration!.toFixed(1)} s; the cut was ${expect.seconds.toFixed(1)} s`);
  }
  if (width && height) {
    const r = width / height;
    if (Math.abs(r - 9 / 16) > 0.02) warnings.push(`Aspect ${width}×${height} is not vertical 9:16`);
  }
  if (!audio) blocking.push("No audio track");
  else if (meanDb === undefined) warnings.push("Audio level could not be measured");
  else if (maxDb! <= -50) blocking.push(`Audio is silent (peak ${maxDb} dB)`);
  else if (meanDb < -35) warnings.push(`Audio is very quiet (mean ${meanDb} dB)`);
  else if (maxDb! >= 0) warnings.push("Audio peaks at 0 dB: may clip");
  let black = 0, frozen = 0;
  for (const m of log.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)) { black += +m[3]; evidence.push(`black ${(+m[1]).toFixed(1)}–${(+m[2]).toFixed(1)} s`); }
  const fs = [...log.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => +m[1]), fd = [...log.matchAll(/freeze_duration: ([\d.]+)/g)].map((m) => +m[1]);
  fs.forEach((s, i) => { const len = fd[i] ?? (duration ? duration - s : 0); frozen += len; evidence.push(`frozen ${s.toFixed(1)}–${(s + len).toFixed(1)} s`); });
  if (duration && black / duration >= 0.5) blocking.push("Mostly black frames");
  else if (black >= 0.5) warnings.push(`${black.toFixed(1)} s of black`);
  if (duration && frozen / duration >= 0.6) blocking.push("Mostly a frozen picture");
  else if (frozen >= 2) warnings.push(`${frozen.toFixed(1)} s frozen`);
  // Captions are burned into the picture (renderClip): their timing is not machine-checked here. Say so instead of claiming it passed.
  const unchecked = expect.captions ? ["Caption timing (burned into the picture): watch it"] : [];
  return { at, pass: !blocking.length, blocking, warnings, unchecked, evidence: evidence.slice(0, 8), facts: { duration, width, height, audio, meanDb, maxDb } };
}

// ---- STU01/STU03: the record ----
export type StoryRef = { id: string; clipJob?: string; opts: { idea: string }; story: { title: string } };
export type Revision = { clip: string; title: string; status: Clip["status"]; edit?: Clip["edit"]; video?: string };
export type ProdRecord = { id: string; job: string; clip: string; title: string; idea?: string; script?: { story: string; title: string };
  source: { name: string; rights?: SourceRights; note?: string; own: boolean }; settings: Clip["edit"] | ClipJob["options"];
  revisions: Revision[]; review: { status: Clip["status"]; approved: boolean; check?: MediaCheck };
  publication?: Clip["publish"]; result?: { videoId: string; url: string }; blockers: string[] };

const SEP = ":"; // deeplink-pure SAFE allows it; job and clip ids never contain it
export const recordId = (job: string, clip: string) => `${job}${SEP}${clip}`;
export function parseRecordId(id: string): { job: string; clip: string } | null {
  const [job, clip, more] = id.split(SEP);
  return job && clip && more === undefined ? { job, clip } : null;
}

/** What still stands between this clip and "ready to publish". [] = ready (the owner's publish click is still required). */
export function blockersOf(job: ClipJob, c: Clip): string[] {
  const out: string[] = [];
  const rights = rightsProblem(job);
  if (rights) out.push(rights);
  const orig = originalityIssue(job, c);
  if (orig && !rights?.includes("recap")) out.push(orig);
  if (c.status !== "approved") out.push(c.status === "ready" ? "Not approved yet" : `Clip is ${c.status}`);
  else if (!c.approvedHash || !c.approvedMedia) out.push("Approval predates revision checks: approve again");
  if (!c.qc) out.push("Media check not run yet");
  else if (!c.qc.pass) out.push(`Media check failed: ${c.qc.blocking.join("; ")}`);
  else if (c.approvedMedia && c.qc.media && c.qc.media !== c.approvedMedia) out.push("Media check is for another render: run it again");
  if (c.publish?.status === "unknown" || c.publish?.status === "uploading") out.push("Last upload's outcome must be checked on YouTube before any retry");
  return out;
}

export function productionRecords(jobs: ClipJob[], stories: StoryRef[] = []): ProdRecord[] {
  const byJob = new Map(stories.filter((s) => s.clipJob).map((s) => [s.clipJob!, s]));
  return jobs.flatMap((j) => {
    const s = byJob.get(j.id);
    return j.clips.map((c): ProdRecord => {
      const root = c.variantOf ?? c.id, family = j.clips.filter((x) => x.id === root || x.variantOf === root); // every render of this moment
      const p = c.publish, live = p && (p.status === "done" || p.status === "scheduled") && p.videoId;
      return { id: recordId(j.id, c.id), job: j.id, clip: c.id, title: c.title, idea: s?.opts.idea, script: s && { story: s.id, title: s.story.title },
        source: { name: j.source, rights: j.rights, note: j.permission, own: !rightsProblem({ ...j, rights: undefined }) },
        settings: c.edit ?? j.options, revisions: family.map((x) => ({ clip: x.id, title: x.title, status: x.status, edit: x.edit, video: x.video })),
        review: { status: c.status, approved: c.status === "approved" && !!c.approvedHash, check: c.qc }, publication: p,
        result: live ? { videoId: p.videoId!, url: p.url ?? `https://youtube.com/shorts/${p.videoId}` } : undefined, blockers: blockersOf(j, c) };
    });
  });
}
