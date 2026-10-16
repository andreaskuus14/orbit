import { access } from "node:fs/promises";
import path from "node:path";
import { askClaude } from "../claude";
import { api } from "../youtube";
import { getJob, listJobs, readState, saveState, studioRoot } from "./factory";
import { tastePrompt } from "./learn";
import { creatorFromSource } from "./titles";
import { DESC_SYSTEM, DRAFTS_SYSTEM, buildDescription, clean, engageDue, engageProblem, latestPublished, parseDrafts, unanswered, type EngageState, type ReplyDrafts } from "./engage-pure";

// Comments inbox + reply drafts + description writer for published Shorts. <studio>/engage.json caches the comments
// (commentThreads.list, 1 quota unit per Short), refreshed on demand at most every 30 min. Pure logic: engage-pure.ts.

const g = globalThis as unknown as { __orbitEngage?: Promise<EngageState> };
const load = () => readState<EngageState>(studioRoot(), "engage", engageProblem);

async function refresh(): Promise<EngageState> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) throw new Error("Set YOUTUBE_API_KEY to read comments");
  const shorts = await Promise.all(latestPublished(await listJobs(), Date.now()).map(async (s) => {
    try {
      const r = await api<Parameters<typeof unanswered>[0]>("commentThreads", { part: "snippet", videoId: s.videoId, maxResults: "20", order: "relevance", textFormat: "plainText" }, key);
      return { ...s, comments: unanswered(r) };
    } catch (e) { // comments off (403) or private video (404): show why instead of failing the whole inbox
      return { ...s, comments: [], error: clean(e instanceof Error ? e.message : String(e), 200) };
    }
  }));
  const state: EngageState = { v: 1, fetchedAt: new Date().toISOString(), shorts };
  await saveState("engage", path.join(studioRoot(), "engage.json"), state);
  return state;
}

/** Cached comments; fetched when there is no cache, or on `force` once 30 min have passed (one fetch at a time). */
export async function engageView(force = false): Promise<EngageState> {
  const s = await load();
  if (s && !(force && engageDue(s, Date.now()))) return s;
  // null + file still there = locked/unreadable (a damaged one is moved aside): don't refetch on every GET
  if (!s && await access(path.join(studioRoot(), "engage.json")).then(() => true, () => false)) throw new Error("engage.json is unreadable (locked by another program?), try later");
  return (g.__orbitEngage ??= refresh().finally(() => { g.__orbitEngage = undefined; }));
}

/** "✨ Draft replies": one background Claude call → a reply per unanswered comment + a pinned-comment idea. Nothing is posted. */
export async function draftReplies(videoId: string, signal?: AbortSignal): Promise<ReplyDrafts> {
  const sh = (await load())?.shorts.find((x) => x.videoId === videoId);
  if (!sh) throw new Error("Short not found — refresh the inbox");
  if (!sh.comments.length) throw new Error("No unanswered comments on this Short");
  const comments = sh.comments.map((c) => JSON.stringify({ commentId: c.id, author: c.author, text: c.text })).join("\n");
  const prompt = `Short title: ${sh.title}\nHook: ${sh.hook}\nWhy the moment works: ${sh.reason}\n<comments>\n${comments}\n</comments>`;
  const r = await askClaude(prompt, DRAFTS_SYSTEM, { lane: "background", signal });
  const d = parseDrafts(r.text, sh.comments.map((c) => c.id));
  if (!d) throw new Error("Claude's reply had no usable drafts — try again");
  return d;
}

/** "✨ Write description": 1–2 lines + credit line (creator known) + 3–5 hashtags incl. #shorts, for the editable publish form. */
export async function writeDescription(jobId: string, clipId: string, signal?: AbortSignal): Promise<string> {
  const job = await getJob(jobId), clip = job?.clips.find((c) => c.id === clipId);
  if (!job || !clip) throw new Error("Clip not found");
  const creator = creatorFromSource(job.source);
  const prompt = `Title: ${clean(clip.title, 100)}\nHook: ${clean(clip.hook, 300)}\nWhy it works: ${clean(clip.reason, 300)}${creator ? `\nCreator: ${creator}` : ""}`;
  const r = await askClaude(prompt, DESC_SYSTEM + (await tastePrompt()), { lane: "background", signal });
  const text = buildDescription(r.text, creator);
  if (!text) throw new Error("Claude's reply had no usable description — try again");
  return text;
}
