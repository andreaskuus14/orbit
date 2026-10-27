// Daily recap reel, IO (rules: recap-pure.ts). Called once at the end of each night shift (night.ts): counts the day that just
// ended from the ledger, tasks and ARCH memories, renders 25 s locally with ffmpeg, and lands it in STUDIO as a ready clip that
// can never be published. Only the newest recap is kept. No model call, no spend.
import { randomBytes } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromRows, type EventRow } from "../ledger-pure";
import { localDay, midnight } from "../week-pure";
import { clipsDir, deleteJob, ffmpegPath, listJobs, runFfmpeg, saveJob, studioRoot } from "./factory";
import { STATE_V } from "./pure";
import { RECAP_SEC, isRecap, pickHighlights, recapArgs, recapAss, recapSource } from "./recap-pure";

const TYPES = ["clip.published", "goal.step", "deal.found", "focus.session"];

/** Renders the recap of the local day that just ended (at night: yesterday). Returns why it didn't, or "" when made/already there. */
export async function makeRecap(sb: SupabaseClient, userId: string, signal: AbortSignal, now = Date.now()): Promise<string> {
  const day = localDay(now - 12 * 3_600_000), source = recapSource(day);
  const jobs = await listJobs();
  if (jobs.some((j) => j.source === source)) return "";
  const since = new Date(midnight(day)).toISOString(), until = new Date(midnight(localDay(midnight(day) + 36 * 3_600_000))).toISOString();
  const [ev, tasks, arch] = await Promise.all([
    sb.from("events").select("id, created_at, type, planet, payload, caused_by").eq("user_id", userId).in("type", TYPES).gte("created_at", since).lt("created_at", until).limit(2000),
    sb.from("tasks").select("title").eq("user_id", userId).is("parent_id", null).eq("status", "done").gte("finished_at", since).lt("finished_at", until).limit(200),
    sb.from("memories").select("id", { count: "exact", head: true }).eq("user_id", userId).contains("tags", ["arch"]).gte("created_at", since).lt("created_at", until),
  ]);
  const cards = pickHighlights({ events: fromRows((ev.data ?? []) as EventRow[]), tasksDone: (tasks.data ?? []).map((t) => String(t.title ?? "")), archVersions: arch.count ?? 0 });
  if (!cards.length) return "A quiet day: nothing to recap";
  const ff = await ffmpegPath();
  if (!ff) return "ffmpeg not found";

  const id = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, dir = path.join(clipsDir(), id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "recap.ass"), recapAss(cards, day), "utf8");
  const musicDir = path.join(studioRoot(), "music"); // the same royalty-free beds AI Story uses; none = silent
  const music = (await readdir(musicDir).catch(() => [] as string[])).filter((f) => /\.(mp3|wav|m4a|ogg)$/i.test(f)).sort()[0];
  await runFfmpeg(ff, recapArgs({ ass: "recap.ass", music: music && path.join(musicDir, music), out: "clip-1.mp4" }), { cwd: dir, signal, timeoutMs: 5 * 60_000 });
  const at = new Date().toISOString();
  await saveJob({ v: STATE_V, id, source, createdAt: at, updatedAt: at, status: "done", progress: 1, step: "Private recap ready", warnings: [], durationSec: RECAP_SEC,
    options: { count: 1, maxSec: RECAP_SEC, captions: false, layout: "fit" },
    clips: [{ id: "clip-1", start: 0, end: RECAP_SEC, title: `Yesterday in 25 seconds (${day})`, hook: "", reason: "ORBIT's own day, made at night", score: 0,
      status: "ready", video: `clips/${id}/clip-1.mp4`, notes: ["Private recap: ORBIT never posts this one"] }] });
  for (const j of jobs) if (isRecap(j)) await deleteJob(j.id).catch(() => {}); // only the newest recap stays
  return "";
}

/** The newest recap for the morning brief, when it's of yesterday and still in STUDIO. */
export async function latestRecap(now = Date.now()): Promise<{ id: string } | null> {
  const j = (await listJobs()).find((x) => x.source === recapSource(localDay(now - 86_400_000)) && x.clips[0]?.status === "ready");
  return j ? { id: j.id } : null;
}
