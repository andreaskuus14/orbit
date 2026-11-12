// Y2 track I/O: file hashes for approvals, and the one paid path (approveStory with all its guards). Pure rules in track-pure.ts.
import path from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { studioRoot } from "./factory";
import { approveStory, getStory } from "./story";
import { generate, type StageId, type Track } from "./track-pure";

/** sha256 of a file inside STUDIO; "" for links, text or anything outside the studio folder. */
export async function fileSha(ref: string): Promise<string> {
  if (/^[a-z]+:\/\//i.test(ref)) return "";
  const root = studioRoot(), f = path.resolve(root, ref);
  if (!f.startsWith(root + path.sep)) return "";
  return readFile(f).then((b) => createHash("sha256").update(b).digest("hex"), () => "");
}
/** Re-hash every artifact from disk so an approval of a file that changed since no longer counts. */
export async function refreshShas(t: Track) {
  for (const a of [...t.frames, ...Object.values(t.out)]) if (a) a.sha = await fileSha(a.ref);
}
/** A track stage's paid generation: track gates, then approveStory (quote hash, Stop-all, Autonomy, weekly cap, one run at a time). */
export async function generateForTrack(t: Track, s: StageId, storyId: string, credits: unknown, seen: unknown, frames: string[]) {
  const job = await getStory(storyId);
  if (!job) return { error: "Story not found" };
  return generate(t, s, seen, frames, (h) => approveStory(job, credits, h));
}
