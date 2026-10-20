import { access } from "node:fs/promises";
import path from "node:path";
import { YT_UPLOAD_SCOPE, hasScopes } from "../yt-analytics-pure";
import { readStored } from "../yt-oauth";
import { writeDescription } from "./engage";
import { getJob, listDownloads, listJobs, readState, saveJob, saveState, studioRoot, updateClip, withJobLock } from "./factory";
import { critiqueClip, learnView } from "./learn";
import { learnProblem, type LearnState } from "./learn-pure";
import { batchStatus, freeSlots, readPublishSettings, scheduleAll } from "./publish-schedule";
import { cleanOriginal, originalityIssue } from "./publish-checks-pure";
import { usedSlots } from "./schedule";
import { ScoutError, actOnPick, runScoutNow, scoutView } from "./scout";
import { autoPicks } from "./scout-pure";
import { rankScore } from "./score-pure";
import { isVideoId } from "../yt-analytics-pure";
import {
  PROPOSE_LEAD_MS, capLeft, confidence, creatorVirality, dailyCap, editProposal, emptyAutopilot, findings, isKey, learnPrefs, parseAutopilot, patchAutopilot, pickTitle, pipeline, proposeSlot, rankCandidates, scoutAutoToday,
  spendDownload, stageCounts, usedDownloads, type Autopilot, type Prefs,
} from "./autopilot-pure";

// YouTube autopilot: an orchestrator over the scout (find), downloads + clip jobs (clip), the clip's own title/thumbnail options +
// the description writer + calendar slots (package), and learn.json (learn). State: <studio>/autopilot.json. Never publishes on its
// own: approve = the clip's normal "approved" status + its proposed slot through scheduleAll (same upload checks as "Schedule all").

const file = () => path.join(studioRoot(), "autopilot.json");
const g = globalThis as unknown as { __orbitAutopilot?: { lock: Promise<unknown>; packing?: Promise<void>; approving?: Promise<unknown> } };
const A = (g.__orbitAutopilot ??= { lock: Promise.resolve() });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function load(): Promise<Autopilot> {
  const x = await readState<unknown>(studioRoot(), "autopilot", (v) => { const r = parseAutopilot(v); return typeof r === "string" ? r : ""; });
  if (x != null) return parseAutopilot(x) as Autopilot;
  // null + file still there = locked/unreadable: don't overwrite settings, counters and proposals with defaults
  if (await access(file()).then(() => true, () => false)) throw new ScoutError("Couldn't read autopilot.json (locked by another program?); try again", 503);
  return emptyAutopilot();
}

function update<T>(fn: (a: Autopilot) => T | Promise<T>): Promise<T> {
  const p = A.lock.then(async () => { const a = await load(); const r = await fn(a); await saveState("autopilot", file(), a); return r; });
  A.lock = p.catch(() => {});
  return p;
}

async function prefsNow(): Promise<Prefs> {
  const [ls, pub] = await Promise.all([readState<LearnState>(studioRoot(), "learn", learnProblem), readPublishSettings()]);
  return learnPrefs(Object.values(ls?.clips ?? {}), pub.timezone, ls?.checkedAt ?? "");
}

export async function autopilotView() {
  await learnView().catch(() => {}); // refreshes published stats at most every 6 h (1 unit per 50 Shorts)
  const now = Date.now();
  const [a, sv, prefs, downloads, jobs] = await Promise.all([A.lock.then(load), scoutView(), prefsNow(), listDownloads(), listJobs()]);
  const candidates = rankCandidates(sv.scout.picks, prefs, now, new Set(a.tracked.map((t) => t.videoId)), creatorVirality(jobs)), scoutAuto = scoutAutoToday(sv.scout.auto, new Date(now));
  const items = pipeline(a.tracked, downloads, jobs, a.proposals, now).reverse(); // newest first
  return {
    settings: { auto: a.auto, dailyDownloads: a.dailyDownloads, options: a.options },
    today: { downloads: usedDownloads(a, new Date(now)), scoutAuto, cap: dailyCap(a), left: capLeft(a, new Date(now), scoutAuto) },
    scout: { running: sv.running, configured: sv.configured, usedToday: sv.usedToday, budget: sv.budget, lastRun: sv.scout.lastRun,
      creators: sv.scout.watchlist.map((w) => w.title), keywords: sv.scout.keywords, runAt: sv.scout.runAt, lastScheduled: sv.scout.lastScheduled },
    candidates: candidates.slice(0, 10), items, counts: stageCounts(items, candidates.length), proposals: a.proposals,
    working: { n: prefs.n, confidence: confidence(prefs.n), findings: findings(prefs), dims: { creator: prefs.dims.creator, length: prefs.dims.length, hour: prefs.dims.hour } },
    slots: await freeSlots(12).then((f) => f.filter((x) => Date.parse(x) >= now + PROPOSE_LEAD_MS && !Object.values(a.proposals).some((p) => p.slot === x)), () => [] as string[]), // for the card's slot picker
  };
}

export const patchSettings = (b: Record<string, unknown>) => update(async (a) => {
  const next = patchAutopilot(b, a);
  if (typeof next === "string") throw new ScoutError(next);
  if (next.auto && !a.auto) next.lastAuto = (await scoutView()).scout.lastRun?.at; // switching on acts on the next scout run, not on old picks
  Object.assign(a, next);
});

/** Shared daily cap left for the scout's own auto-clips, or null when the autopilot isn't in use (then the scout's dailyAuto alone applies). */
export async function sharedCapLeft(now: Date): Promise<number | null> {
  const a = await A.lock.then(load);
  if (!a.auto && !a.tracked.length) return null;
  return capLeft(a, now, scoutAutoToday((await scoutView()).scout.auto, now));
}

/** "Find candidates": the scout run (watchlist + topics), with its own quota guard. */
export const findCandidates = () => runScoutNow();

/** Downloads + clip jobs for these picks with the autopilot's options, within today's cap. Returns what started / why not. */
async function clipPicks(a: Autopilot, ids: string[], auto: boolean) {
  const now = new Date(), sc = (await scoutView()).scout, picks = sc.picks, started: string[] = [], errors: string[] = [];
  for (const id of ids) {
    if (!capLeft(a, now, scoutAutoToday(sc.auto, now))) { errors.push(`Today's cap of ${a.dailyDownloads} is reached; more tomorrow`); break; }
    const p = picks.find((x) => x.videoId === id);
    if (!p || p.status !== "new" || a.tracked.some((t) => t.videoId === id)) { errors.push(`${p?.title ?? id}: already clipped or gone`); continue; }
    try {
      await actOnPick(id, "clip", a.options, auto ? `Autopilot (auto-picked): ${p.channel} is on the watchlist with auto-clip allowed` : `Autopilot: the owner chose to clip this ${p.source === "watchlist" ? "watchlist" : "keyword"} find`);
      spendDownload(a, now);
      a.tracked.push({ videoId: id, title: p.title, channel: p.channel, at: now.toISOString(), auto });
      started.push(p.title);
    } catch (e) { errors.push(`${p.title}: ${msg(e)}`); }
  }
  return { started, errors };
}

export function clipNow(ids: unknown) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 5 || !ids.every((x) => typeof x === "string" && isVideoId(x))) throw new ScoutError("videoIds must be 1-5 video ids");
  return update((a) => clipPicks(a, ids as string[], false));
}

/** Title / description / slot proposals for finished autopilot clips (at most 3 per call: each description is a Claude call). */
async function packageReady() {
  const now = Date.now(), a = await load(), [jobs, downloads, pub, prefs] = await Promise.all([listJobs(), listDownloads(), readPublishSettings(), prefsNow()]);
  const items = pipeline(a.tracked, downloads, jobs, a.proposals, now);
  const live = new Set(items.flatMap((i) => i.clips.filter((c) => c.stage === "packaging" || c.stage === "waiting").map((c) => c.key))); // still needs the owner
  const stale = Object.entries(a.proposals).filter(([k, p]) => live.has(k) && p.slot && Date.parse(p.slot) < now + 20 * 60_000).map(([k]) => k); // slot passed: propose again
  const clipOf = (key: string) => { const [j, c] = key.split("/"); return jobs.find((x) => x.id === j)?.clips.find((x) => x.id === c); };
  const rank = (key: string) => { const c = clipOf(key); return c ? rankScore(c) : 0; }; // best-scoring clips get packaged (and so reviewed) first
  const todo = [...items.flatMap((i) => i.clips.filter((c) => c.stage === "packaging").map((c) => c.key)).sort((a, b) => rank(b) - rank(a)), ...stale].slice(0, 3);
  const made: Record<string, Autopilot["proposals"][string]> = {};
  for (const key of todo) {
    const [jobId, clipId] = key.split("/"), job = jobs.find((j) => j.id === jobId), clip = job?.clips.find((c) => c.id === clipId);
    if (!job || !clip) continue;
    const old = a.proposals[key], cr = old ? null : await critiqueClip(jobId, clipId); // title critics: ≤ 1 extra call per clip, skipped when busy
    const opts = cr?.options ?? clip.titleOptions, t = old ? { title: old.title, why: old.titleWhy } : pickTitle(opts, clip.title, prefs, cr ? "Critics' score" : undefined);
    if (!old && cr?.rewrite && cr.rewrite === t.title) t.why = `The critics' rewrite of their best option. ${t.why}`;
    const description = old?.description ?? await writeDescription(jobId, clipId, AbortSignal.timeout(2 * 60_000), t.title).catch(() => undefined); // fallback: the upload's default (hook + #shorts)
    const taken = Object.entries({ ...a.proposals, ...made }).filter(([k]) => k !== key).map(([, p]) => p.slot).filter((s): s is string => !!s);
    const s = proposeSlot(pub, usedSlots(jobs, now), taken, now, prefs);
    made[key] = { title: t.title, titleWhy: t.why, thumb: clip.thumb, description, slot: s.slot, slotWhy: s.why, at: new Date().toISOString(), video: clip.video,
      alts: old?.alts ?? (opts ?? []).map((o) => o.text).filter((x) => x !== t.title).slice(0, 2), notes: old?.notes ?? cr?.notes };
  }
  await update((x) => {
    for (const k of Object.keys(x.proposals)) if (!live.has(k)) delete x.proposals[k]; // scheduled, published, rejected or deleted
    for (const [k, p] of Object.entries(made)) if (JSON.stringify(x.proposals[k]) === JSON.stringify(a.proposals[k])) x.proposals[k] = p; // the owner edited it meanwhile: his wins
  });
}

export const packageNow = () => (A.packing ??= packageReady().catch((e) => console.error("[orbit] autopilot packaging failed:", msg(e))).finally(() => { A.packing = undefined; }));

/** The owner swaps the title or picks another free slot on a waiting proposal. */
export async function editWaiting(key: unknown, b: Record<string, unknown>) {
  if (!isKey(key)) throw new ScoutError("key must be <job>/<clip>");
  const free = b.slot === undefined ? [] : (await freeSlots(60)).filter((x) => Date.parse(x) >= Date.now() + PROPOSE_LEAD_MS);
  await update((a) => {
    const p = a.proposals[key];
    if (!p) throw new ScoutError("That proposal is gone; refresh", 404);
    const next = editProposal(p, b, free.filter((x) => !Object.entries(a.proposals).some(([k, o]) => k !== key && o.slot === x)));
    if (typeof next === "string") throw new ScoutError(next, 409);
    a.proposals[key] = next;
  });
}

/** "Review titles" on a waiting card: the critics' notes + their best other options as runner-ups (the title itself stays the owner's call). */
export async function reviewWaiting(key: unknown) {
  if (!isKey(key)) throw new ScoutError("key must be <job>/<clip>");
  if (!(await A.lock.then(load)).proposals[key]) throw new ScoutError("That proposal is gone; refresh", 404);
  const [jobId, clipId] = key.split("/"), cr = await critiqueClip(jobId, clipId);
  if (!cr) throw new ScoutError("Couldn't review the titles right now (Claude is busy or usage is high); try again later", 503);
  await update((a) => { const p = a.proposals[key]; if (p) a.proposals[key] = { ...p, notes: cr.notes, alts: cr.options.map((o) => o.text).filter((x) => x !== p.title).slice(0, 2) }; });
}

/** Approve = the clip's normal approved status with the proposed title, then scheduled into exactly the proposed slot (taken → error,
 *  a new proposal is made) through scheduleAll: same file / slot / upload checks, one upload at a time, no auto-retry. */
export function approve(key: unknown, original?: unknown) { // one approve at a time: two quick ones can't race for the batch or the same slot
  const p = (A.approving ?? Promise.resolve()).then(() => approveOne(key, original));
  A.approving = p.catch(() => {});
  return p;
}

async function approveOne(key: unknown, rawOriginal?: unknown) {
  if (!isKey(key)) throw new ScoutError("key must be <job>/<clip>");
  const original = cleanOriginal(rawOriginal);
  if (original === null) throw new ScoutError("original must be text of at most 200 characters");
  if (batchStatus()?.running) throw new ScoutError("Clips are being scheduled right now; approve again when that finishes", 409);
  const s = await readStored();
  if (!s) throw new ScoutError("Connect YouTube first", 409);
  if (!hasScopes(s.scope, [YT_UPLOAD_SCOPE])) throw new ScoutError("Reconnect YouTube to allow uploads", 403);
  const p = (await A.lock.then(load)).proposals[key];
  if (!p) throw new ScoutError("That proposal is gone; refresh", 404);
  const title = p.title.replace(/[\x00-\x1f\x7f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100).trim();
  if (!title) throw new ScoutError("The proposed title is empty; edit the clip in Clips", 409);
  if (!p.slot || !(await freeSlots(60)).includes(p.slot)) { // never a silent move to another time: the owner approves a slot
    void packageNow(); // re-proposes it (slot passed or taken)
    throw new ScoutError("That slot isn't free any more; a new one is being proposed — refresh and approve again", 409);
  }
  const [jobId, clipId] = key.split("/");
  await withJobLock(async () => {
    const job = await getJob(jobId), clip = job?.clips.find((c) => c.id === clipId);
    if (!job || !clip) throw new ScoutError("Clip not found", 404);
    if (clip.status !== "ready" && clip.status !== "approved") throw new ScoutError(`Clip is ${clip.status}`, 409);
    if (clip.publish && clip.publish.status !== "failed") throw new ScoutError("This clip is already on its way to YouTube", 409);
    if (original !== undefined && original !== clip.original) { clip.original = original || undefined; await saveJob(job); } // kept even if refused below
    const notOriginal = originalityIssue(job, clip);
    if (notOriginal) throw new ScoutError(notOriginal, 409);
    await updateClip(job, clip, { status: "approved", title });
  });
  const batch = await scheduleAll([key], { [key]: { publishAt: p.slot, description: p.description } });
  if (typeof batch === "string") {
    await withJobLock(async () => { // back to ready: an approved clip would be picked up by "Schedule all" at another time
      const job = await getJob(jobId), clip = job?.clips.find((c) => c.id === clipId);
      if (!job || !clip || clip.status !== "approved" || clip.publish) return;
      clip.status = "ready";
      const fb = job.feedback ?? [], i = fb.findLastIndex((f) => f.clipId === clipId);
      if (i >= 0 && fb[i].action === "approved") fb.splice(i, 1); // not a real review decision
      await saveJob(job);
    }).catch((e) => console.error("[orbit] autopilot couldn't undo approve:", msg(e)));
    throw new ScoutError(`Not scheduled: ${batch}. The clip is back in Waiting for you.`, 409);
  }
  return batch;
}

/** Every 5 min on the scout's timer (local files only, no quota): auto mode acts once on each new scout run, then packaging. */
export async function autopilotTick() {
  if ((await import("../stop-all")).stopAllOn() || (await import("../usage-meter")).usageHold()) return; // kill switch / usage backoff: no auto-clips, no packaging calls
  const a = await load();
  if (!a.tracked.length && !a.auto) return; // never used: nothing to do
  const run = (await scoutView()).scout.lastRun;
  if (a.auto && run?.ok && run.at !== a.lastAuto) {
    await update(async (x) => {
      if (!x.auto || x.lastAuto === run.at) return;
      x.lastAuto = run.at; // set first: a failure never makes it retry (and spend) on every tick
      const sc = (await scoutView()).scout, now = new Date();
      const allowed = autoPicks(sc.picks, sc.watchlist, sc.picks.length); // only watchlist creators the owner marked autoClip
      const top = rankCandidates(allowed, await prefsNow(), now.getTime(), new Set(x.tracked.map((t) => t.videoId)), creatorVirality(await listJobs()));
      const r = await clipPicks(x, top.slice(0, capLeft(x, now, scoutAutoToday(sc.auto, now))).map((c) => c.videoId), true);
      if (r.errors.length) console.error("[orbit] autopilot auto-clip:", r.errors.join("; "));
    });
  }
  await packageNow();
}
