import type { Clip, ClipJob } from "./types";
import type { Analysis, Span } from "./pure";

/** Consent covers this exact render and the linked original, not future edits or another video. */
export const retryFingerprint = (c: Clip) => JSON.stringify([c.retryOf, c.title, c.hook, c.start, c.end, c.video, c.thumb]);
export const retryConsent = (c: Clip) => !!c.retryOf && c.status === "approved" && !!c.retryApproved?.at && c.retryApproved.fingerprint === retryFingerprint(c);

export function canRetry(c: Clip, job: ClipJob): boolean {
  return !c.retryOf && !c.flopRetry && (c.status === "ready" || c.status === "approved")
    && (c.publish?.status === "done" || c.publish?.status === "scheduled") && !!c.publish.videoId
    && !job.clips.some((x) => x.retryOf?.clipId === c.id);
}

/** A different non-overlapping hype peak when its transcript is available; otherwise keep the original span. */
export function retrySpan(c: Clip, job: ClipJob, a: Analysis): Span {
  const len = c.end - c.start;
  for (const p of [...(job.hype?.peaks ?? [])].sort((x, y) => y.height - x.height)) {
    const start = Math.max(0, Math.min(a.duration - len, p.t - len / 3)), end = start + len;
    if (start < 0 || start < c.end && end > c.start) continue;
    if (a.words.some((w) => w.start >= start && w.end <= end)) return { start, end };
  }
  return { start: c.start, end: c.end };
}

export function mayReplace(old: Clip, retry: Clip): boolean {
  return !!old.flopRetry?.clipId && old.flopRetry.clipId === retry.id && !old.flopRetry.privateAt && !old.flopRetry.restoredAt
    && retry.retryOf?.clipId === old.id && retry.retryOf.videoId === old.publish?.videoId && retryConsent(retry)
    && (retry.publish?.status === "done" || retry.publish?.status === "scheduled") && !!retry.publish.videoId
    && retry.publish.videoId !== old.publish?.videoId && retry.publish.title === retry.title;
}

/** Preserve writable status properties; never send read-only upload/madeForKids fields back to YouTube. */
export function privacyStatus(status: Record<string, unknown>, privacy: "private" | "public") {
  return { ...Object.fromEntries(["embeddable", "publicStatsViewable", "selfDeclaredMadeForKids", "containsSyntheticMedia"]
    .filter((k) => typeof status[k] === "boolean").map((k) => [k, status[k]])),
    ...(typeof status.license === "string" ? { license: status.license } : {}), privacyStatus: privacy };
}
