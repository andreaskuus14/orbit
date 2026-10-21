import { stat } from "node:fs/promises";
import path from "node:path";
import { stopAllOn } from "../stop-all";
import { usageHold } from "../usage-meter";
import { changeRetryPrivacy } from "../youtube-privacy";
import { getJob, inboxDir, isJobBusy, listJobs, loadAnalysis, saveJob, startVersion, withJobLock } from "./factory";
import { isInboxName } from "./pure";
import { flops24, type LearnState } from "./learn-pure";
import { canRetry, mayReplace, retrySpan } from "./flop-retry-pure";
import type { Clip } from "./types";

const note = (c: Clip, text: string) => { (c.notes ??= []).push(`${new Date().toISOString()}: ${text}`); };

/** Durable claim before startVersion: even a crash or failed render never spends a second retry on this clip. */
export async function retryFlops(s: LearnState) {
  for (const r of flops24(Object.values(s.clips))) {
    if (stopAllOn() || usageHold()) return;
    await withJobLock(async () => {
      const job = await getJob(r.jobId), old = job?.clips.find((c) => c.id === r.clipId);
      if (!job || !old || isJobBusy(job) || !canRetry(old, job) || old.publish?.videoId !== r.videoId) return;
      const a = await loadAnalysis(job.id);
      if (!a || !isInboxName(job.source) || !(await stat(path.join(inboxDir(), job.source)).catch(() => null))?.isFile()) return;
      if (stopAllOn() || usageHold()) return;
      old.flopRetry = { at: new Date().toISOString() };
      note(old, "Flopped (24h): below half the channel median. One retry claimed; never automatically published.");
      await saveJob(job);
      try {
        const next = await startVersion(job, old, { edit: {}, dStart: 0, dEnd: 0, suggest: true }, a,
          { span: retrySpan(old, job, a), of: { clipId: old.id, videoId: r.videoId, title: old.publish.title ?? old.title } });
        if (typeof next === "string") throw new Error(next);
      } catch (e) {
        old.flopRetry.error = e instanceof Error ? e.message : "Retry could not start";
        await saveJob(job);
      }
    });
  }
}

/** Approval alone never hides anything: the exact approved replacement must also be confirmed public on this channel. */
export async function reconcileReplacements() {
  for (const j of await listJobs()) for (const c of j.clips) {
    if (stopAllOn()) return;
    if (!c.flopRetry?.clipId || c.flopRetry.privateAt || c.flopRetry.restoredAt) continue;
    await withJobLock(async () => {
      const job = await getJob(j.id), old = job?.clips.find((x) => x.id === c.id);
      const replacement = job?.clips.find((x) => x.id === old?.flopRetry?.clipId);
      if (!job || !old?.flopRetry || !replacement || !mayReplace(old, replacement) || stopAllOn()) return;
      const state = old.flopRetry;
      if (state.privacyPending === undefined) note(old, `Approved retry ${replacement.publish!.videoId} will replace https://youtube.com/shorts/${old.publish!.videoId}. Restore makes the old Short public; never deleted.`);
      state.privacyPending = true; // persisted before a possible write; unknown outcomes can be restored too
      await saveJob(job);
      try {
        const done = await changeRetryPrivacy(old.publish!.videoId!, "private", replacement.publish!.videoId);
        if (done) {
          state.privateAt = new Date().toISOString(); state.error = undefined;
          old.publish!.privacy = "private";
          note(old, `Old Short set private after approved retry became public. Restore: https://youtube.com/shorts/${old.publish!.videoId}`);
        }
        state.privacyPending = false;
      } catch (e) { state.error = e instanceof Error ? e.message : "Privacy change failed; outcome may be unknown"; }
      await saveJob(job);
    });
  }
}

/** Invoked only by the authenticated owner's Restore POST, under the same lock as background replacement. */
export async function restoreOriginal(jobId: string, clipId: string, seenVideoId: string) {
  return withJobLock(async () => {
    const job = await getJob(jobId), old = job?.clips.find((c) => c.id === clipId);
    if (!job || !old?.flopRetry || old.publish?.videoId !== seenVideoId) throw new Error("Retry original changed or is missing; reload first");
    const state = old.flopRetry;
    if (state.restoredAt) return old;
    if (!state.privateAt && !state.privacyPending) throw new Error("This original has not been replaced");
    if (stopAllOn()) throw new Error("Stop-all is on");
    await changeRetryPrivacy(seenVideoId, "public");
    state.restoredAt = new Date().toISOString(); state.privacyPending = false; state.error = undefined;
    old.publish.privacy = "public";
    note(old, `Restored https://youtube.com/shorts/${seenVideoId} to public by the owner's Restore click. Automatic replacement is disabled for this pair.`);
    await saveJob(job);
    return old;
  });
}
