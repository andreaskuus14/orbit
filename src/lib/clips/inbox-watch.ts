import { access, readdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { cleanPermission, isInboxName, validOptions } from "./pure.ts";
import type { ClipOptions, Download } from "./types";
import { DEVLOG_DIR, bumpDay, isRemuxedMkv, maxJobDay } from "./devlog.ts";

// Inbox watcher: stream files the owner drops into <studio>/inbox (from creators, clipping programs, Discord) get a clip job on their own.
// Polls instead of fs.watch, which misses events on Windows network/OneDrive folders. factory is imported lazily so the pure
// helpers below stay importable by the tests without the server's dependencies.

export const POLL_MS = 30_000;
export const STABLE_POLLS = 2; // size+mtime unchanged across this many polls in a row = the copy finished
export const MAX_STARTED = 500;
export type Started = { name: string; size: number; mtimeMs: number };
// since: only files that arrived after this. started: files auto-clipped before (newest last): never auto-started again, even after their job is deleted.
export type InboxAuto = { enabled: boolean; options: Required<ClipOptions>; since: string; started?: Started[] };
// ctime too: Windows can preallocate the full size, but each write still moves ctime.
export type Seen = { size: number; mtimeMs: number; ctimeMs: number; stable: number };
export type Polled = { name: string; size: number; mtimeMs: number; ctimeMs: number; arrivedMs: number; fromOrbit: boolean };

// ---- pure ----

/** Downloader/copy temp files: yt-dlp's .part/.ytdl and "x.temp.mp4" merge files. */
export const isTempName = (name: string) => /\.(part|ytdl|temp)(\.|$)/i.test(name);

/** Next poll's stability counters: +1 when size and mtime didn't change, back to 0 when they did; vanished files are dropped. */
export function trackStable(prev: Map<string, Seen>, files: Pick<Polled, "name" | "size" | "mtimeMs" | "ctimeMs">[]): Map<string, Seen> {
  const next = new Map<string, Seen>();
  for (const f of files) {
    const p = prev.get(f.name);
    const same = p && p.size === f.size && p.mtimeMs === f.mtimeMs && p.ctimeMs === f.ctimeMs;
    next.set(f.name, { size: f.size, mtimeMs: f.mtimeMs, ctimeMs: f.ctimeMs, stable: same ? p.stable + 1 : 0 });
  }
  return next;
}

/** Files to start a job for: finished copying, new since auto-clip was turned on, not ORBIT's own download, and never had a job. */
export function readyFiles(files: Polled[], seen: Map<string, Seen>, jobSources: Set<string>, sinceMs: number, started: Started[] = []): Polled[] {
  return files.filter((f) => isInboxName(f.name) && !isTempName(f.name) && !f.fromOrbit && f.size > 0 && f.arrivedMs >= sinceMs &&
    !jobSources.has(f.name) && !started.some((x) => sameFile(x, f)) && (seen.get(f.name)?.stable ?? 0) >= STABLE_POLLS);
}

const sameFile = (a: Started, b: Started) => a.name === b.name && a.size === b.size && a.mtimeMs === b.mtimeMs;
/** started list with f added (newest last), capped at MAX_STARTED. */
export const rememberStarted = (list: Started[] = [], f: Started): Started[] =>
  [...list.filter((x) => !sameFile(x, f)), { name: f.name, size: f.size, mtimeMs: f.mtimeMs }].slice(-MAX_STARTED);

/** The job's source note: first line of <video>.source.txt, else the "permission" of <video>.source.json ("" when neither). */
export function sourceNote(txt?: string | null, json?: string | null): string {
  const line = txt?.replace(/^﻿/, "").split(/\r?\n/).find((l) => l.trim());
  if (line) return cleanPermission(line) ?? cleanPermission(line.slice(0, 300)) ?? "";
  try { return cleanPermission(JSON.parse(json ?? "")?.permission) ?? ""; } catch { return ""; }
}

/** inbox-auto.json checked; "" problem = valid (readState's contract). */
export function inboxAutoProblem(x: unknown): string {
  if (!x || typeof x !== "object") return "not a JSON object";
  const o = x as Record<string, unknown>;
  if (typeof o.enabled !== "boolean") return "enabled must be true or false";
  if (!o.options || typeof o.options !== "object") return "options missing";
  const opts = validOptions(o.options as Record<string, unknown>);
  if (typeof opts === "string") return `options: ${opts}`;
  if (typeof o.since !== "string" || Number.isNaN(Date.parse(o.since))) return "since must be a date";
  if (o.started !== undefined && !(Array.isArray(o.started) && o.started.every((x) => x && typeof x.name === "string" && Number.isFinite(x.size) && Number.isFinite(x.mtimeMs))))
    return "started must be a list of { name, size, mtimeMs }";
  return "";
}

export const defaultInboxAuto = (now: Date, enabled = true): InboxAuto => ({ enabled, options: validOptions({}) as Required<ClipOptions>, since: now.toISOString() });

// Devlog folder (<inbox>/devlog): the owner's own build recordings (OBS) → devlog-preset jobs. Each finished file is moved up into the
// inbox (the pipeline reads sources from there) and started; started holds its inbox name so the main watcher never re-clips it.
// days: the "Day N" counter per series (devlog.ts bumpDay). Always starts OFF.
export type DevlogAuto = InboxAuto & { days: Record<string, number> };
export const defaultDevlog = (now: Date): DevlogAuto =>
  ({ enabled: false, options: validOptions({ count: 3, maxSec: 60, preset: "devlog" }) as Required<ClipOptions>, since: now.toISOString(), days: {} });
export function devlogProblem(x: unknown): string {
  const p = inboxAutoProblem(x);
  if (p) return p;
  const d = (x as Record<string, unknown>).days;
  return d && typeof d === "object" && Object.values(d).every((n) => Number.isInteger(n)) ? "" : "days must be { series: number }";
}
/** Inbox name for a devlog file: its own name, or a "devlog-<n>-" prefixed one when the inbox already has that name. */
export function devlogTarget(name: string, taken: Set<string>, n = Date.now()): string {
  if (!taken.has(name)) return name;
  const pre = `devlog-${n.toString(36)}-`;
  return pre + name.slice(-(255 - pre.length)); // cut from the start: the extension must survive
}

// ---- I/O ----

type St = { timer?: NodeJS.Timeout; busy?: boolean; seen: Map<string, Seen>; seenDev?: Map<string, Seen>; lock: Promise<unknown>; devProblem?: string };
const g = globalThis as unknown as { __orbitInboxWatch?: St }; // survives dev hot reloads: one timer
const S: St = (g.__orbitInboxWatch ??= { seen: new Map(), lock: Promise.resolve() } as St);
const factory = () => import("./factory");
// One settings file per id in the studio root: inbox-auto.json, devlog.json. fresh(on): defaults; on = a first-ever file (never after damage).
type Store<T> = { id: string; problem: (x: unknown) => string; fresh: (on: boolean) => T };
const INBOX: Store<InboxAuto> = { id: "inbox-auto", problem: inboxAutoProblem, fresh: (on) => defaultInboxAuto(new Date(), on) };
const DEVLOG: Store<DevlogAuto> = { id: "devlog", problem: devlogProblem, fresh: () => defaultDevlog(new Date()) };
const settingsFile = async (id: string) => path.join((await factory()).studioRoot(), `${id}.json`);
const settingsExist = async (id: string) => access(await settingsFile(id)).then(() => true, () => false);

/** Settings, created with defaults the first time. null = file there but unreadable (locked): try again later. */
async function readSettings<T extends InboxAuto>(st: Store<T>): Promise<T | null> {
  const f = await factory();
  const existed = await settingsExist(st.id);
  const x = await f.readState<T>(f.studioRoot(), st.id, st.problem);
  if (x) return { ...x, options: validOptions(x.options as unknown as Record<string, unknown>) as Required<ClipOptions> };
  if (await settingsExist(st.id)) return null;
  return updateSettings(st, () => {}, existed); // existed but now gone = readState quarantined a damaged file
}

/** Read-modify-write of a settings file, one at a time (tmp + rename via saveState). */
function updateSettings<T>(st: Store<T>, fn: (s: T) => void, damaged = false): Promise<T> {
  const p = S.lock.then(async () => {
    const f = await factory();
    const existed = await settingsExist(st.id);
    const cur = await f.readState<T>(f.studioRoot(), st.id, st.problem);
    if (!cur && await settingsExist(st.id)) throw new Error(`Couldn't read ${st.id}.json (locked by another program?); try again`);
    // Only a first-ever file starts on; after a damaged one was set aside, auto-clip stays off until the owner turns it back on.
    const s = cur ?? st.fresh(!(damaged || existed));
    fn(s);
    await f.saveState(st.id, await settingsFile(st.id), s);
    return s;
  });
  S.lock = p.catch(() => {});
  return p;
}

export const readInboxAuto = () => readSettings(INBOX);
export const updateInboxAuto = (fn: (s: InboxAuto) => void) => updateSettings(INBOX, fn);
export const readDevlog = () => readSettings(DEVLOG);
export const updateDevlog = (fn: (s: DevlogAuto) => void) => updateSettings(DEVLOG, fn);
export const devlogDir = async () => path.join((await factory()).inboxDir(), DEVLOG_DIR);
/** Takes the series' next "Day N" (saved before it's used, so two jobs never share a day). */
export async function nextDevlogDay(): Promise<number> {
  let day = 1;
  const floor = maxJobDay(await (await factory()).listJobs());
  await updateDevlog((s) => { const b = bumpDay(s.days, undefined, floor); s.days = b.days; day = b.day; });
  return day;
}

/** Last devlog move problem worth showing the owner (e.g. the folder is on another drive), "" = none. */
export const devlogMoveProblem = () => S.devProblem ?? "";

/** Starts the 30 s poll once per server process. */
export function startInboxWatch() {
  if (S.timer) return;
  S.timer = setInterval(() => void poll(), POLL_MS);
  S.timer.unref?.();
  void poll();
}

/** Video files in dir with their stats. own: names ORBIT itself is downloading/downloaded. */
async function listVideos(dir: string, own: Set<unknown>): Promise<Polled[]> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => isInboxName(n) && !isTempName(n));
  return (await Promise.all(names.map(async (name): Promise<Polled | null> => {
    const s = await stat(path.join(dir, name)).catch(() => null);
    if (!s?.isFile()) return null;
    // A downloaded file whose download record was removed still has ORBIT's .source.json with the link.
    const meta = await readFile(path.join(dir, `${name}.source.json`), "utf8").then((t) => JSON.parse(t), () => null);
    // Windows copies keep the original mtime; birthtime/ctime is when the file landed here.
    return { name, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, arrivedMs: Math.max(s.birthtimeMs, s.ctimeMs, s.mtimeMs), fromOrbit: own.has(name) || typeof meta?.url === "string" };
  }))).filter((x): x is Polled => !!x);
}

/** Devlog folder pass: finished recordings → moved into the inbox → devlog job (lands in the review queue; never published on its own). */
async function pollDevlog(f: Awaited<ReturnType<typeof factory>>, inboxNames: Set<string>): Promise<Started[]> {
  const dir = await devlogDir();
  const files = await listVideos(dir, new Set());
  S.seenDev = trackStable(S.seenDev ?? new Map(), files);
  const cfg = await readDevlog();
  if (!cfg?.enabled) return cfg?.started ?? [];
  const others = [...files.map((x) => x.name), ...(cfg.started ?? []).map((x) => x.name)];
  const ready = readyFiles(files, S.seenDev, new Set(), Date.parse(cfg.since)).filter((x) => !isRemuxedMkv(x.name, others));
  if (!ready.length) return cfg.started ?? [];
  const tools = await f.checkTools();
  if (!tools.ffmpeg) return cfg.started ?? [];
  let started = cfg.started ?? [];
  for (const file of ready) {
    const target = devlogTarget(file.name, inboxNames);
    const s = await updateDevlog((x) => { x.started = rememberStarted(x.started, { ...file, name: target }); }); // rename keeps size + mtime
    started = s.started ?? [];
    try { await rename(path.join(dir, file.name), path.join(f.inboxDir(), target)); S.devProblem = ""; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EXDEV") { // rename can't cross drives: say so once, not every 30 s
        const msg = "The devlog folder is on a different drive than the inbox, so recordings can't be moved. Keep it inside the inbox folder.";
        if (S.devProblem !== msg) console.error(`[orbit] devlog: ${msg}`);
        S.devProblem = msg;
      } else console.error(`[orbit] devlog: couldn't move ${file.name} (still recording?):`, e instanceof Error ? e.message : e);
      continue;
    }
    inboxNames.add(target);
    await f.createJob(target, { ...cfg.options, preset: "devlog", captions: cfg.options.captions && tools.transcriber }, "Own recording (devlog)");
    console.log(`[orbit] devlog: auto-clipping ${target}`);
  }
  return started;
}

async function poll() {
  if (S.busy) return;
  S.busy = true;
  try {
    const f = await factory();
    const dir = f.inboxDir();
    const own = new Set((await f.listDownloads()).flatMap((d: Download) => [d.file, ...(d.parts ?? [])]).filter(Boolean));
    const devStarted = await pollDevlog(f, new Set(await readdir(dir).catch(() => [] as string[]))).catch(async (e) => {
      console.error("[orbit] devlog watch error:", e instanceof Error ? e.message : e);
      return (await readDevlog().catch(() => null))?.started ?? [];
    });
    const files = await listVideos(dir, own); // after the devlog pass: its moved files already have jobs
    S.seen = trackStable(S.seen, files);

    const cfg = await readInboxAuto();
    if (!cfg?.enabled) return;
    const jobSources = new Set((await f.listJobs()).map((j) => j.source));
    const ready = readyFiles(files, S.seen, jobSources, Date.parse(cfg.since), [...(cfg.started ?? []), ...devStarted]);
    if (!ready.length) return;
    const tools = await f.checkTools();
    if (!tools.ffmpeg) return; // don't burn the file's one auto job on a failure; retried once ffmpeg is there
    for (const file of ready) {
      const { name } = file;
      await updateInboxAuto((s) => { s.started = rememberStarted(s.started, file); }); // before the job: a failed save must not lead to repeats
      const [txt, json] = await Promise.all([`${name}.source.txt`, `${name}.source.json`].map((n) => readFile(path.join(dir, n), "utf8").catch(() => null)));
      const note = sourceNote(txt, json);
      await f.createJob(name, { ...cfg.options, preset: "viral", captions: cfg.options.captions && tools.transcriber }, note || undefined); // never a devlog: that's the devlog folder's job
      console.log(`[orbit] inbox: auto-clipping ${name}`);
    }
  } catch (e) {
    console.error("[orbit] inbox watch error:", e instanceof Error ? e.message : e);
  } finally { S.busy = false; }
}
