import { stat } from "node:fs/promises";
import path from "node:path";
import { videoResource } from "../yt-analytics-pure";
import { clipFile, getJob, isPublishing, listJobs, publishDone, readState, saveState, startPublish, studioRoot, withJobLock } from "./factory";
import { DEFAULT_PUBLISH, nextSlots, parseSettings, usedSlots, type PublishSettings } from "./schedule";
import type { Clip } from "./types";

// Scheduled publishing (server side): owner's slot settings in <studio>/publish.json and "Schedule all approved", which uploads clips
// one at a time into the next free slots through the normal upload path (startPublish/runPublish: no auto-retry, unknown → stop).

export const readPublishSettings = async (): Promise<PublishSettings> =>
  (await readState<PublishSettings>(studioRoot(), "publish", (x) => { const r = parseSettings(x); return typeof r === "string" ? r : ""; })) ?? DEFAULT_PUBLISH;
export const savePublishSettings = (s: PublishSettings) => saveState("publish", path.join(studioRoot(), "publish.json"), s);

/** The next free slots (ISO), skipping every clip already scheduled in any job. */
export async function freeSlots(count = 1): Promise<string[]> {
  const now = Date.now();
  return nextSlots(await readPublishSettings(), usedSlots(await listJobs(), now), now, count);
}

export type Batch = { running: boolean; total: number; scheduled: number; error?: string; at: string };
const g = globalThis as unknown as { __orbitSchedule?: { batch?: Batch } };
const B = (g.__orbitSchedule ??= {});
export const batchStatus = () => B.batch ?? null;

const eligible = (c: Clip) => c.status === "approved" && (!c.publish || c.publish.status === "failed");

/** Starts scheduling every approved, unpublished clip (background, sequential). Returns the batch, or a message for a 409.
 *  only: "<job>/<clip>" keys to limit it to (a CORE plan's picks). meta: per key, a wanted slot (must still be free) and description (autopilot). */
export async function scheduleAll(only?: string[], meta: Record<string, { publishAt?: string; description?: string }> = {}): Promise<Batch | string> {
  if (B.batch?.running) return "Already scheduling clips";
  const batch: Batch = (B.batch = { running: true, total: 0, scheduled: 0, at: new Date().toISOString() }); // claimed before any await
  const todo = await listJobs().then((jobs) => jobs.flatMap((j) => j.clips.filter((c) => eligible(c) && (!only || only.includes(`${j.id}/${c.id}`))).map((c) => [j.id, c.id] as const)), (e) => { batch.running = false; throw e; });
  if (!todo.length) { batch.running = false; return "No approved, unpublished clips to schedule"; }
  batch.total = todo.length;
  void (async () => {
    for (const [jobId, clipId] of todo) {
      let r: string;
      do { // wait for any upload (e.g. a manual one) to finish, then start ours under the lock
        await publishDone();
        r = await withJobLock(async () => {
          if (isPublishing()) return "busy";
          const job = await getJob(jobId), clip = job?.clips.find((c) => c.id === clipId);
          if (!job || !clip || !eligible(clip)) return "skip"; // changed meanwhile (published, rejected, deleted)
          const file = clipFile(clip);
          if (!file || !(await stat(file).catch(() => null))?.isFile()) return `${clip.title}: the video file is missing`;
          const want = meta[`${jobId}/${clipId}`];
          if (want?.publishAt && !(await freeSlots(60)).includes(want.publishAt)) return `${clip.title}: the chosen slot isn't free any more`; // never moved silently
          const [at] = want?.publishAt ? [want.publishAt] : await freeSlots();
          if (!at) return "No free slot in the next 6 months";
          const video = videoResource({ publishAt: at, ...(want?.description && { description: want.description }) }, clip);
          if (typeof video === "string") return `${clip.title}: ${video}`;
          await startPublish(job, clip, file, video);
          return "started";
        });
      } while (r === "busy");
      if (r === "skip") { batch.total--; continue; }
      if (r !== "started") { batch.error = r; break; }
      await publishDone();
      const c = (await getJob(jobId))?.clips.find((x) => x.id === clipId);
      if (c?.publish?.status !== "scheduled") { // failed or unknown: the owner decides (retry / Check YouTube); never retried here
        batch.error = `Stopped at “${c?.title ?? clipId}”: ${c?.publish?.error ?? "the upload didn't finish"}`;
        break;
      }
      batch.scheduled++;
    }
  })().catch((e) => { batch.error = e instanceof Error ? e.message : "Scheduling stopped"; }).finally(() => { batch.running = false; });
  return batch;
}
