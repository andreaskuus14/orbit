import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { cleanPermission, isInboxName, validOptions } from "./pure.ts";
import type { ClipOptions, Download } from "./types";

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

// ---- I/O ----

type St = { timer?: NodeJS.Timeout; busy?: boolean; seen: Map<string, Seen>; lock: Promise<unknown> };
const g = globalThis as unknown as { __orbitInboxWatch?: St }; // survives dev hot reloads: one timer
const S = (g.__orbitInboxWatch ??= { seen: new Map(), lock: Promise.resolve() });
const factory = () => import("./factory");
const settingsFile = async () => path.join((await factory()).studioRoot(), "inbox-auto.json");

const settingsExist = async () => access(await settingsFile()).then(() => true, () => false);

/** Settings, created with defaults (on, from now) the first time. null = file there but unreadable (locked): try again later. */
export async function readInboxAuto(): Promise<InboxAuto | null> {
  const f = await factory();
  const existed = await settingsExist();
  const x = await f.readState<InboxAuto>(f.studioRoot(), "inbox-auto", inboxAutoProblem);
  if (x) return { ...x, options: validOptions(x.options as unknown as Record<string, unknown>) as Required<ClipOptions> };
  if (await settingsExist()) return null;
  return updateInboxAuto(() => {}, existed); // existed but now gone = readState quarantined a damaged file
}

/** Read-modify-write of inbox-auto.json, one at a time (tmp + rename via saveState). */
export function updateInboxAuto(fn: (s: InboxAuto) => void, damaged = false): Promise<InboxAuto> {
  const p = S.lock.then(async () => {
    const f = await factory();
    const existed = await settingsExist();
    const cur = await f.readState<InboxAuto>(f.studioRoot(), "inbox-auto", inboxAutoProblem);
    if (!cur && await settingsExist()) throw new Error("Couldn't read inbox-auto.json (locked by another program?); try again");
    // Only a first-ever file starts on; after a damaged one was set aside, auto-clip stays off until the owner turns it back on.
    const s = cur ?? defaultInboxAuto(new Date(), !(damaged || existed));
    fn(s);
    await f.saveState("inbox-auto", await settingsFile(), s);
    return s;
  });
  S.lock = p.catch(() => {});
  return p;
}

/** Starts the 30 s poll once per server process. */
export function startInboxWatch() {
  if (S.timer) return;
  S.timer = setInterval(() => void poll(), POLL_MS);
  S.timer.unref?.();
  void poll();
}

async function poll() {
  if (S.busy) return;
  S.busy = true;
  try {
    const f = await factory();
    const dir = f.inboxDir();
    const [jobs, downloads] = await Promise.all([f.listJobs(), f.listDownloads()]);
    const own = new Set(downloads.flatMap((d: Download) => [d.file, ...(d.parts ?? [])]).filter(Boolean));
    const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => isInboxName(n) && !isTempName(n));
    const files = (await Promise.all(names.map(async (name): Promise<Polled | null> => {
      const s = await stat(path.join(dir, name)).catch(() => null);
      if (!s?.isFile()) return null;
      // A downloaded file whose download record was removed still has ORBIT's .source.json with the link.
      const meta = await readFile(path.join(dir, `${name}.source.json`), "utf8").then((t) => JSON.parse(t), () => null);
      // Windows copies keep the original mtime; birthtime/ctime is when the file landed here.
      return { name, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, arrivedMs: Math.max(s.birthtimeMs, s.ctimeMs, s.mtimeMs), fromOrbit: own.has(name) || typeof meta?.url === "string" };
    }))).filter((x): x is Polled => !!x);
    S.seen = trackStable(S.seen, files);

    const cfg = await readInboxAuto();
    if (!cfg?.enabled) return;
    const ready = readyFiles(files, S.seen, new Set(jobs.map((j) => j.source)), Date.parse(cfg.since), cfg.started);
    if (!ready.length) return;
    const tools = await f.checkTools();
    if (!tools.ffmpeg) return; // don't burn the file's one auto job on a failure; retried once ffmpeg is there
    for (const file of ready) {
      const { name } = file;
      await updateInboxAuto((s) => { s.started = rememberStarted(s.started, file); }); // before the job: a failed save must not lead to repeats
      const [txt, json] = await Promise.all([`${name}.source.txt`, `${name}.source.json`].map((n) => readFile(path.join(dir, n), "utf8").catch(() => null)));
      const note = sourceNote(txt, json);
      await f.createJob(name, { ...cfg.options, captions: cfg.options.captions && tools.transcriber }, note || undefined);
      console.log(`[orbit] inbox: auto-clipping ${name}`);
    }
  } catch (e) {
    console.error("[orbit] inbox watch error:", e instanceof Error ? e.message : e);
  } finally { S.busy = false; }
}
