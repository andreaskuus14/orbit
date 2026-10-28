import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { MINED_EVENTS, activeBand, addCorrection, clipLabel, correctionLesson, decide, keptText, lessonBoost, lessonsPrompt, mine, nicheTraits, opensWithNumber,
  parseStore, reconcile, withPrior, type Signal, type Store, type Stored } from "./lessons-pure";

// Learning loop I/O (logic: lessons-pure.ts). Nightly (sleep.ts) the owner's own decisions are mined into proposed lessons;
// he keeps or rejects them in Profile → "What I learned about you"; corrections in chat propose one at once.
// State: <ORBIT data dir>/lessons.json (local only; lessons quote his decisions, never LIFE or journal data).

const file = () => path.join(orbitDataDir(), "lessons.json");
const DAY = 86_400_000;
const g = globalThis as unknown as { __orbitLessons?: Promise<unknown> };

async function load(): Promise<Store> {
  const s = parseStore(await readFile(file(), "utf8").catch((e) => { if (e.code === "ENOENT") return ""; throw e; }));
  if (!s) throw new Error("lessons.json is unreadable; fix or move it aside (nothing was overwritten).");
  return s;
}
/** Read-modify-write, one at a time, saved atomically. */
function update<T>(fn: (s: Store) => T): Promise<T> {
  const p = (g.__orbitLessons ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load();
    const out = fn(s);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s, null, 1));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitLessons = p;
  return p;
}
const mineOf = (s: Store, userId: string) => (s.users[userId] ??= { lessons: [] });
const kept = async (userId?: string): Promise<Stored[]> => {
  const s = await load();
  return (userId ? s.users[userId]?.lessons ?? [] : Object.values(s.users).flatMap((u) => u.lessons)).filter((l) => l.status === "kept");
};

// ---- signals: each source is optional; a failing one is skipped ----
async function eventSignals(sb: SupabaseClient, userId: string, since: string): Promise<Signal[]> {
  const { data, error } = await sb.from("events").select("id, type, payload, created_at").eq("user_id", userId).in("type", [...MINED_EVENTS])
    .gte("created_at", since).order("created_at", { ascending: false }).limit(5000);
  if (error) throw error;
  return (data ?? []).flatMap((e): Signal[] => {
    const p = (e.payload ?? {}) as Record<string, unknown>, id = `event:${e.id}`, at = new Date(e.created_at).toISOString();
    if ((e.type === "morning.click" || e.type === "morning.done") && typeof p.source === "string") return [{ id, at, area: "morning.source", key: p.source, label: p.source.toUpperCase() }];
    if (e.type === "morning.thumb" && typeof p.kind === "string" && typeof p.up === "boolean") return [{ id, at, area: "morning.kind", key: p.kind, label: p.kind, ok: p.up }];
    if (e.type === "memory.hygiene" && typeof p.action === "string") return [{ id, at, area: "hygiene", key: p.action, label: p.action === "merge" ? "merge" : "retract", ok: p.decision === "accepted" }];
    if (e.type === "core.started") { const b = activeBand(new Date(at).getHours()); return [{ id, at, area: "active", key: b.key, label: b.label }]; } // PC-local hour
    return [];
  });
}

async function proposalSignals(sb: SupabaseClient, userId: string, since: string, now: number): Promise<Signal[]> {
  const { data, error } = await sb.from("proposals").select("id, agent, kind, status, created_at, decided_at").eq("user_id", userId).gte("created_at", since).limit(1000);
  if (error) throw error;
  return (data ?? []).flatMap((p): Signal[] => {
    // A proposal left pending for a week counts as ignored.
    const ok = p.status === "approved" ? true : p.status === "dismissed" || now - Date.parse(p.created_at) > 7 * DAY ? false : undefined;
    if (ok === undefined) return [];
    const at = new Date(p.decided_at ?? p.created_at).toISOString(), id = `proposal:${p.id}`;
    return [{ id, at, area: "proposal.agent", key: p.agent, label: p.agent, ok }, { id, at, area: "proposal.kind", key: p.kind, label: p.kind, ok }];
  });
}

async function clipSignals(): Promise<Signal[]> {
  const [{ listJobs }, { featuresOf }] = await Promise.all([import("./clips/factory"), import("./clips/learn-pure")]);
  const out: Signal[] = [];
  for (const job of await listJobs()) {
    const last = new Map<string, { ok: boolean; reason?: string; at: string }>(); // his latest approve/reject per clip; publishing counts as approval
    for (const f of job.feedback ?? []) if (f.action !== "version") last.set(f.clipId, { ok: f.action !== "rejected", reason: f.reason, at: f.at });
    for (const c of job.clips) {
      const d = last.get(c.id);
      if (!d) continue;
      const id = `clip:${job.id}/${c.id}`;
      for (const [dim, label] of Object.entries(featuresOf(job, c))) {
        if (label !== "unknown" && label !== "other") out.push({ id, at: d.at, area: `clip.${dim}`, key: label, label: clipLabel(dim, label), ok: d.ok });
      }
      const r = d.reason?.trim().toLowerCase();
      if (!d.ok && r && r !== "other") out.push({ id, at: d.at, area: "clip.reason", key: r, label: r });
    }
  }
  return out;
}

async function businessSignals(sb: SupabaseClient, userId: string, since: string): Promise<Signal[]> {
  const { data, error } = await sb.from("prospects").select("id, stage, template, draft, updated_at").eq("user_id", userId).neq("stage", "lead").gte("updated_at", since).limit(1000);
  if (error) throw error;
  return (data ?? []).flatMap((p): Signal[] => {
    const ok = ["replied", "pilot", "paying"].includes(p.stage), at = new Date(p.updated_at).toISOString(), id = `prospect:${p.id}`;
    const out: Signal[] = [];
    if (p.template) out.push({ id, at, area: "outreach.angle", key: p.template, label: p.template, ok });
    if (typeof p.draft === "string" && p.draft.trim()) { const n = opensWithNumber(p.draft); out.push({ id, at, area: "outreach.open", key: n ? "number" : "plain", label: n ? "open with a concrete number" : "open without a number", ok }); }
    return out;
  });
}

async function nicheSignals(): Promise<Signal[]> {
  // Same file as niche.ts (local niche board); read-only here.
  const raw = await readFile(path.join(orbitDataDir(), "business", "niches.json"), "utf8").catch(() => "");
  const niches = raw ? ((JSON.parse(raw) as { niches?: { id: string; at: string; status: string; demandScore: number; competitionScore: number }[] }).niches ?? []) : [];
  return niches.filter((n) => n.status === "kept" || n.status === "dismissed")
    .flatMap((n) => nicheTraits(n).map((t) => ({ id: `niche:${n.id}`, at: n.at, area: "niche", key: t.key, label: t.label, ok: n.status === "kept" })));
}

/** Nightly: mine every source, reconcile with what he already kept/rejected. Returns how many lessons are newly proposed. Never throws. */
export async function mineLessons(sb: SupabaseClient, userId: string, now = Date.now()): Promise<number> {
  const since = new Date(now - 180 * DAY).toISOString();
  const soft = (name: string) => (e: unknown) => { console.warn(`[lessons] ${name} skipped:`, e instanceof Error ? e.message : e); return [] as Signal[]; };
  const parts = await Promise.all([eventSignals(sb, userId, since).catch(soft("events")), proposalSignals(sb, userId, since, now).catch(soft("proposals")),
    clipSignals().catch(soft("clips")), businessSignals(sb, userId, since).catch(soft("business")), nicheSignals().catch(soft("niches"))]);
  const exp = await import("./clips/experiments").then((m) => m.experimentLessons(now)).catch((e) => { console.warn("[lessons] experiments skipped:", e instanceof Error ? e.message : e); return []; });
  const fresh = [...mine(parts.flat(), now), ...exp]; // experiment lessons are proposals like the rest: kept only on his click
  try {
    return await update((s) => {
      const u = mineOf(s, userId), before = new Set(u.lessons.map((l) => l.id));
      u.lessons = reconcile(u.lessons, fresh, now);
      u.minedAt = new Date(now).toISOString();
      return u.lessons.filter((l) => l.status === "proposed" && !before.has(l.id)).length;
    });
  } catch (e) { console.error("[lessons] not saved:", e instanceof Error ? e.message : e); return 0; }
}

export async function lessonsView(userId: string) {
  const u = (await load()).users[userId] ?? { lessons: [] };
  return { proposed: u.lessons.filter((l) => l.status === "proposed"), kept: u.lessons.filter((l) => l.status === "kept"),
    rejected: u.lessons.filter((l) => l.status === "rejected").length, minedAt: u.minedAt ?? null };
}

export async function decideLesson(userId: string, id: string, decision: "keep" | "reject"): Promise<string | null> {
  return update((s) => {
    const u = mineOf(s, userId), r = decide(u.lessons, id, decision, Date.now());
    if (typeof r === "string") return r;
    u.lessons = r;
    return null;
  });
}

/** He just corrected CORE: propose a lesson (one tap to keep in chat). null when it isn't a correction. Never throws. */
export async function captureCorrection(userId: string, text: string, prevReply: string, messageId: string): Promise<{ id: string; text: string } | null> {
  const l = correctionLesson(text, prevReply, messageId, Date.now());
  if (!l) return null;
  try {
    const added = await update((s) => { const u = mineOf(s, userId), r = addCorrection(u.lessons, l); u.lessons = r.lessons; return r.added; });
    return added && { id: added.id, text: added.text };
  } catch (e) { console.warn("[lessons] correction not saved:", e instanceof Error ? e.message : e); return null; }
}

/** CORE prompt block ("" when none apply or on any failure). */
export const lessonsContext = (userId: string, question: string) => kept(userId).then((k) => lessonsPrompt(k, question), () => "");
/** Morning candidates nudged by kept lessons (unchanged on failure). */
export const morningPrior = <T extends { base: number; source?: string; kind: string }>(userId: string, cands: T[]) => kept(userId).then((k) => withPrior(cands, k), () => cands);
/** Night-shift prior for one work kind (night-pure NIGHT_KINDS), 1 when nothing applies. */
export const nightBoost = (userId: string, kind: string) => kept(userId).then((k) => lessonBoost(k, [kind]), () => 1);
/** Kept lessons of one planet for owner-less background prompts (single-owner ORBIT: every profile's kept lessons). */
/** His kept lessons (future-self call). */
export const keptLessons = (userId: string) => kept(userId);
export const keptLessonsText = (planet: string) => kept().then((k) => keptText(k, planet), () => "");
