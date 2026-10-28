// Content handoff checks (pure, tested in tests/handoff.test.ts): prepare → review → approved publish. No new publishing authority:
// these only refuse or report. I/O in factory.ts (file hash at approval and at upload, Check YouTube, the post-upload destination check).
import type { ClipPublish } from "./types";

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const SHA = /^[0-9a-f]{64}$/;

/** "" when the file about to be uploaded is byte-for-byte the one he approved (sha256 hex of both); otherwise why not. */
export function mediaProblem(approved: unknown, actual: unknown): string {
  if (typeof approved !== "string" || !SHA.test(approved)) return "This clip was approved before media checks existed: open it, watch it and approve again";
  if (typeof actual !== "string" || !SHA.test(actual)) return "Couldn't read the clip's video file";
  return approved === actual ? "" : "The video file changed since you approved it: watch it and approve again";
}

/** "" when an upload may start. An unknown outcome must have been looked up on the channel (Check YouTube) before any retry,
 *  even a forced one: not found there yet is the owner's call, never found-nothing-because-we-never-looked. */
export function retryProblem(p: Pick<ClipPublish, "status" | "checkedAt"> | undefined, force: boolean): string {
  return p?.status === "unknown" && !(force && p.checkedAt) ? "The last upload's outcome is unknown — check YouTube first" : "";
}

/** After an upload: does YouTube's videos.list (part=snippet,status) item match what was sent? "" = yes, else what's wrong. */
export function destinationProblem(want: { videoId: string; title: string; privacy: string; publishAt?: string }, json: unknown): string {
  const it = isObj(json) && Array.isArray(json.items) ? json.items.find((i) => isObj(i) && i.id === want.videoId) : undefined;
  if (!isObj(it) || !isObj(it.snippet) || !isObj(it.status)) return "not found on the channel yet";
  const st = it.status, up = st.uploadStatus;
  if (up === "failed" || up === "rejected" || up === "deleted") return `YouTube marked it ${up}${typeof st.rejectionReason === "string" ? ` (${st.rejectionReason})` : typeof st.failureReason === "string" ? ` (${st.failureReason})` : ""}`;
  const norm = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
  if (norm(it.snippet.title) !== norm(want.title)) return "the title on YouTube differs from the one sent";
  if (want.publishAt) {
    if (st.privacyStatus !== "private" || Date.parse(String(st.publishAt)) !== Date.parse(want.publishAt)) return "the schedule on YouTube differs from the one sent";
  } else if (st.privacyStatus !== want.privacy) return `it is ${String(st.privacyStatus)} on YouTube, not ${want.privacy}`;
  return "";
}
