// Roblox dev session log (roadmap 4.2), IO half: <data dir>/dev-sessions/sessions.json plus playtest PNGs (<uuid>.png) beside it.
// Recording is best effort and never throws: a full disk must not fail a finished Studio run. Ledger: dev.session.start/end, ids only.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, emit, FAST_MODEL, recordUsage } from "./claude";
import { stopAllOn } from "./stop-all";
import { PAUSED_MSG } from "./stop-all-pure";
import { usageHardHold } from "./usage-meter";
import {
  SUMMARY_SYSTEM, addEvent, briefSession, cleanSummary, closeIdle, dayNumber, fallbackSummary, parseSessions, sessionIdea, sessionLine, sessionStats, shotRef, summaryPrompt,
  type DevEvent, type DevSession,
} from "./dev-session-pure";

const dir = () => path.join(orbitDataDir(), "dev-sessions");
const file = () => path.join(dir(), "sessions.json");
const png = (id: string) => path.join(dir(), `${id}.png`);
const g = globalThis as unknown as { __orbitDevSess?: Promise<unknown> };

async function load(): Promise<DevSession[]> {
  try { return parseSessions(JSON.parse(await readFile(file(), "utf8"))); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT" || e instanceof SyntaxError) return []; throw e; }
}

/** Serialised read-modify-write (all writers go through here). */
function update<T>(fn: (s: DevSession[]) => T | Promise<T>): Promise<T> {
  const p = (g.__orbitDevSess ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load();
    const out = await fn(s);
    await mkdir(dir(), { recursive: true });
    await writeFile(`${file()}.tmp`, JSON.stringify(s));
    await rename(`${file()}.tmp`, file());
    return out;
  });
  g.__orbitDevSess = p;
  return p;
}

const ended = (sb: SupabaseClient, userId: string, closed: DevSession[]) =>
  Promise.all(closed.filter((c) => c.userId === userId).map((c) => emit(sb, userId, "dev.session.end", "creation", { session: c.id })));

/** One Studio run → the open session (a new one when he's been away IDLE_MS). `image`: a PNG data URL from the bridge, saved by id. */
export async function recordDevEvent(sb: SupabaseClient, userId: string, ev: DevEvent, image?: string | null): Promise<void> {
  try {
    if (image?.startsWith("data:image/png;base64,")) {
      const id = randomUUID();
      await mkdir(dir(), { recursive: true });
      await writeFile(png(id), Buffer.from(image.slice(image.indexOf(",") + 1), "base64"));
      ev.shots.push(id);
    }
    const r = await update((s) => addEvent(s, userId, ev, Date.now(), randomUUID));
    for (const d of r.dropped) for (const e of d.events) for (const sh of e.shots) if (!sh.startsWith("build:")) await rm(png(sh), { force: true });
    if (r.started) await emit(sb, userId, "dev.session.start", "creation", { session: r.session.id });
    await ended(sb, userId, r.closed);
  } catch (e) { console.error("[orbit] dev session not recorded", e instanceof Error ? e.message : e); }
}

export type SessionView = DevSession & { line: string; stats: ReturnType<typeof sessionStats> };
const view = (s: DevSession, now: number): SessionView => ({ ...s, line: sessionLine(s, now), stats: sessionStats(s, now) });

/** His sessions, newest first; idle ones are closed on the way (that's when their end event is written). */
export async function listDevSessions(sb: SupabaseClient, userId: string): Promise<SessionView[]> {
  const now = Date.now();
  const all = await load();
  if (all.some((s) => !s.end && now - Date.parse(s.last) > 30 * 60_000)) {
    const closed = await update((s) => closeIdle(s, now));
    await ended(sb, userId, closed);
    return listDevSessions(sb, userId);
  }
  return all.filter((s) => s.userId === userId).reverse().map((s) => view(s, now));
}

/** Sessions he started since `from` (read only: the daily mission's game dev target). */
export const devSessionsSince = async (userId: string, from: number) => (await load()).filter((s) => s.userId === userId && Date.parse(s.start) >= from).length;

export class SessionError extends Error {}

const mine = (s: DevSession[], userId: string, id: string) => {
  const hit = s.find((x) => x.id === id && x.userId === userId);
  if (!hit) throw new SessionError("Session not found");
  return hit;
};

/** End now (he pressed End); with `summarize`, one fast-model summary follows. */
export async function endDevSession(sb: SupabaseClient, userId: string, id: string, summarize: boolean): Promise<SessionView> {
  const now = Date.now();
  const s = await update((all) => {
    const hit = mine(all, userId, id);
    const was = !hit.end;
    if (was) hit.end = new Date(Math.max(now, Date.parse(hit.last))).toISOString();
    return { hit, was };
  });
  if (s.was) await emit(sb, userId, "dev.session.end", "creation", { session: id });
  return summarize ? summarizeDevSession(sb, userId, id) : view(s.hit, now);
}

/** One fast-model call (optional, his click); any failure keeps the plain counts summary. */
export async function summarizeDevSession(sb: SupabaseClient, userId: string, id: string): Promise<SessionView> {
  const now = Date.now();
  const s = mine(await load(), userId, id);
  const fallback = fallbackSummary(s, now);
  let text = fallback;
  const held = stopAllOn() ? PAUSED_MSG : usageHardHold();
  if (held) throw new SessionError(held);
  try {
    const r = await askClaude(summaryPrompt(s, now), SUMMARY_SYSTEM, { lane: "foreground", model: FAST_MODEL, timeoutMs: 30_000, purpose: "devsession.summary" });
    void recordUsage(sb, userId, "devsession.summary", r, FAST_MODEL);
    text = cleanSummary(r.text, fallback);
  } catch (e) { console.error("[orbit] dev session summary failed; using counts", e instanceof Error ? e.message : e); }
  return update((all) => { const hit = mine(all, userId, id); hit.summary = text; return view(hit, now); });
}

/** The session as a "Day N" Short idea in IDEA RADAR (STUDIO). Once per session; nothing is generated or spent. */
export async function devSessionIdea(userId: string, id: string): Promise<{ ideaId: string; title: string }> {
  const now = Date.now();
  const all = await load();
  const s = mine(all, userId, id);
  if (s.ideaId) return { ideaId: s.ideaId, title: "" };
  const idea = sessionIdea(s, dayNumber(all, s), s.summary ?? fallbackSummary(s, now), now, randomUUID());
  const { updateIdeas } = await import("./ideas");
  await updateIdeas((ideas) => [idea, ...ideas]);
  await update((x) => { mine(x, userId, id).ideaId = idea.id; });
  return { ideaId: idea.id, title: idea.title };
}

/** One of his own session PNGs, or null. `ref` comes from the URL: validated here. */
export async function readSessionShot(userId: string, ref: unknown): Promise<Buffer | null> {
  if (!shotRef(ref) || ref.startsWith("build:")) return null;
  if (!(await load()).some((s) => s.userId === userId && s.events.some((e) => e.shots.includes(ref)))) return null;
  try { return await readFile(png(ref)); } catch { return null; }
}

/** For the morning brief (brief.ts). */
export const yesterdaySession = async (userId: string, now: number) => briefSession(await load(), userId, now);
