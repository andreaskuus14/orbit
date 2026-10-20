import type { Clip, ClipJob } from "./types.ts";

// Checks before and after a clip goes to YouTube (pure; tested in tests/publish-checks.test.ts).
// Since 1 Oct 2026 YouTube shows Shorts re-uploaded from other creators "without adding anything of your own" to fewer people,
// and channels that mainly do that get less reach. So a clip from someone else's video needs the owner's own layer, stated in words.

export const ORIGINAL_MIN = 10, ORIGINAL_MAX = 200;

/** Own footage: the devlog preset clips the owner's own Roblox build sessions. Everything else may be another creator's video. */
export const ownSource = (job: Pick<ClipJob, "options">) => job.options.preset === "devlog";

/** The "what I added" note from a request: trimmed string, null if invalid, undefined if not sent. */
export function cleanOriginal(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") return null;
  const s = v.replace(/[\x00-\x1f\x7f<>]/g, " ").replace(/\s+/g, " ").trim();
  return s.length > ORIGINAL_MAX ? null : s;
}

/** Why this clip can't be published yet, or null. */
export function originalityIssue(job: Pick<ClipJob, "options">, clip: Pick<Clip, "original">): string | null {
  if (ownSource(job) || (clip.original?.trim().length ?? 0) >= ORIGINAL_MIN) return null;
  return "This clip is from another creator's video. Since 1 Oct 2026 YouTube shows re-uploads to fewer people. " +
    "Add your own layer first (your commentary, reaction or analysis) and describe it in “What I added”.";
}

type PubInfo = { publish?: { status: string; privacy?: string; scheduledFor?: string; error?: string } };
/** Upload problems ORBIT can see from its own records, as short lines for the owner. */
export function uploadHealth(jobs: { clips: PubInfo[] }[], now = Date.now()): string[] {
  const clips = jobs.flatMap((j) => j.clips);
  const n = (f: (c: PubInfo) => boolean) => clips.filter(f).length;
  const priv = n((c) => c.publish?.status === "done" && c.publish.privacy === "private");
  const overdue = n((c) => c.publish?.status === "scheduled" && !!c.publish.scheduledFor && Date.parse(c.publish.scheduledFor) < now);
  const signIn = n((c) => c.publish?.status === "failed" && /reconnect youtube/i.test(c.publish.error ?? ""));
  const s = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return [
    priv && `${s(priv, "upload is", "uploads are")} still private on YouTube, so nobody can see ${priv === 1 ? "it" : "them"}. Make ${priv === 1 ? "it" : "them"} public in YouTube Studio if you meant to.`,
    overdue && `${s(overdue, "scheduled clip has", "scheduled clips have")} passed ${overdue === 1 ? "its" : "their"} publish time. ORBIT can't confirm YouTube made ${overdue === 1 ? "it" : "them"} public: check YouTube Studio.`,
    signIn && `${s(signIn, "upload", "uploads")} failed because the YouTube sign-in expired. Reconnect YouTube. If your Google app is in "Testing", sign-ins expire every 7 days; publish the consent screen to "In production" to stop that.`,
  ].filter((x): x is string => !!x);
}
