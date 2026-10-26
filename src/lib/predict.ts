import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { clipLabel, nicheTraits, opensWithNumber } from "./lessons-pure";
import { eligible, parseStore, score, step, weeklyLine, type Decision, type Feature, type Item, type PArea, type Prediction, type Store } from "./predict-pure";

// Approval predictions I/O (logic: predict-pure.ts). Each refresh reads his decisions and the items waiting for him from the same
// sources the lessons loop mines (clip jobs, proposals, prospects, hygiene, niches, deals), scores guesses he has since decided and
// records a guess for each new waiting item. State: <ORBIT data dir>/predictions.json (local; ids and feature labels only).

const file = () => path.join(orbitDataDir(), "predictions.json");
const DAY = 86_400_000, FRESH_MS = 60_000;
const g = globalThis as unknown as { __orbitPredict?: Promise<unknown>; __orbitPredictAt?: Record<string, number> };
type Gathered = { decisions: Decision[]; pending: Item[] };
const none: Gathered = { decisions: [], pending: [] };

async function load(): Promise<Store> {
  const s = parseStore(await readFile(file(), "utf8").catch((e) => { if (e.code === "ENOENT") return ""; throw e; }));
  if (!s) throw new Error("predictions.json is unreadable; fix or move it aside (nothing was overwritten).");
  return s;
}
function update<T>(fn: (s: Store) => T): Promise<T> {
  const p = (g.__orbitPredict ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load(), out = fn(s);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitPredict = p;
  return p;
}

const feat = (key: string, label: string): Feature => ({ key, label });

async function clips(): Promise<Gathered> {
  const [{ listJobs }, { featuresOf }] = await Promise.all([import("./clips/factory"), import("./clips/learn-pure")]);
  const out: Gathered = { decisions: [], pending: [] };
  for (const job of await listJobs()) {
    const last = new Map<string, { ok: boolean; at: string }>(); // his latest approve/reject per clip; publishing counts as approval
    for (const f of job.feedback ?? []) if (f.action !== "version") last.set(f.clipId, { ok: f.action !== "rejected", at: f.at });
    for (const c of job.clips) {
      const d = last.get(c.id);
      if (!d && c.status !== "ready") continue;
      const f = Object.entries(featuresOf(job, c)).filter(([, l]) => l !== "unknown" && l !== "other").map(([dim, l]) => feat(`${dim}=${l}`, clipLabel(dim, l)));
      const id = `clip:${job.id}/${c.id}`;
      if (d) out.decisions.push({ id, area: "clips", at: d.at, ok: d.ok, f }); else out.pending.push({ id, area: "clips", f });
    }
  }
  return out;
}

async function proposals(sb: SupabaseClient, userId: string, since: string, now: number): Promise<Gathered> {
  const { data, error } = await sb.from("proposals").select("id, agent, kind, status, created_at, decided_at").eq("user_id", userId).gte("created_at", since).limit(1000);
  if (error) throw error;
  const out: Gathered = { decisions: [], pending: [] };
  for (const p of data ?? []) {
    const id = `proposal:${p.id}`, f = [feat(`agent=${p.agent}`, `proposals from ${p.agent}`), feat(`kind=${p.kind}`, `${p.kind} proposals`)];
    // Same rule as the lessons loop: left pending for a week counts as ignored (= rejected).
    const ok = p.status === "approved" ? true : p.status === "dismissed" || now - Date.parse(p.created_at) > 7 * DAY ? false : undefined;
    if (ok !== undefined) out.decisions.push({ id, area: "proposals", at: new Date(p.decided_at ?? p.created_at).toISOString(), ok, f });
    else if (p.status === "pending") out.pending.push({ id, area: "proposals", f });
  }
  return out;
}

async function drafts(sb: SupabaseClient, userId: string, since: string): Promise<Gathered> {
  const { data, error } = await sb.from("prospects").select("id, kind, stage, template, draft, updated_at").eq("user_id", userId).gte("updated_at", since).limit(1000);
  if (error) throw error;
  const out: Gathered = { decisions: [], pending: [] };
  for (const p of data ?? []) {
    if (typeof p.draft !== "string" || !p.draft.trim()) continue;
    const n = opensWithNumber(p.draft), kind = String(p.kind ?? "").trim().toLowerCase().slice(0, 40);
    const f = [feat(`open=${n ? "number" : "plain"}`, n ? "drafts that open with a number" : "drafts without a number up front"),
      ...(p.template ? [feat(`angle=${p.template}`, `the “${p.template}” angle`)] : []), ...(kind ? [feat(`kind=${kind}`, `drafts to ${kind} businesses`)] : [])];
    // A draft is his to approve while the lead is untouched; sent (contacted or later) = approved, lead → lost = rejected.
    const id = `draft:${p.id}`;
    if (p.stage === "lead") out.pending.push({ id, area: "drafts", f });
    else out.decisions.push({ id, area: "drafts", at: new Date(p.updated_at).toISOString(), ok: p.stage !== "lost", f });
  }
  return out;
}

async function hygiene(sb: SupabaseClient, userId: string, since: string): Promise<Gathered> {
  const raw = await readFile(path.join(orbitDataDir(), "hygiene.json"), "utf8").catch(() => "");
  const props = ((raw ? JSON.parse(raw) : {})?.users?.[userId]?.proposals ?? []) as { key: string; action: string; why: string; status: string }[];
  const why = new Map(props.map((p) => [p.key, p.why]));
  const fOf = (key: string, action: string) => [feat(`action=${action}`, `${action} suggestions`), ...(why.get(key) ? [feat(`why=${why.get(key)}`, `“${why.get(key)}” suggestions`)] : [])];
  const { data, error } = await sb.from("events").select("payload, created_at").eq("user_id", userId).eq("type", "memory.hygiene").gte("created_at", since).limit(2000);
  if (error) throw error;
  const decisions = (data ?? []).flatMap((e): Decision[] => {
    const p = (e.payload ?? {}) as { key?: unknown; action?: unknown; decision?: unknown };
    return typeof p.key === "string" && typeof p.action === "string" ? [{ id: `hygiene:${p.key}`, area: "hygiene", at: new Date(e.created_at).toISOString(), ok: p.decision === "accepted", f: fOf(p.key, p.action) }] : [];
  });
  return { decisions, pending: props.filter((p) => p.status === "pending").map((p) => ({ id: `hygiene:${p.key}`, area: "hygiene" as const, f: fOf(p.key, p.action) })) };
}

async function niches(): Promise<Gathered> {
  const raw = await readFile(path.join(orbitDataDir(), "business", "niches.json"), "utf8").catch(() => "");
  const list = raw ? ((JSON.parse(raw) as { niches?: { id: string; at: string; status: string; demandScore: number; competitionScore: number; fitScore: number }[] }).niches ?? []) : [];
  const out: Gathered = { decisions: [], pending: [] };
  for (const n of list) {
    const f = [...nicheTraits(n).map((t) => feat(t.key, `${t.label} niches`)), ...(n.fitScore >= 4 ? [feat("fit:high", "niches that fit you well")] : n.fitScore <= 2 ? [feat("fit:low", "niches that fit you poorly")] : [])];
    const id = `niche:${n.id}`;
    if (n.status === "new") out.pending.push({ id, area: "niches", f }); // decided at: unknown, n.at (found) is the closest we have
    else out.decisions.push({ id, area: "niches", at: n.at, ok: n.status === "kept", f });
  }
  return out;
}

async function deals(now: number): Promise<Gathered> {
  const raw = await readFile(path.join(orbitDataDir(), "deals.json"), "utf8").catch(() => "");
  const s = raw ? (JSON.parse(raw) as { offers?: Record<string, { id: string; firstSeen: string; great: boolean; condition: string; site: string; risks: string[] }[]>; alerted?: Record<string, number> }) : {};
  const out: Gathered = { decisions: [], pending: [] };
  // Dismissed ("Not interested") offers leave deals.json; their features live on in the guess (predict-pure step).
  for (const [id, v] of Object.entries(s.alerted ?? {})) if (v === 0) out.decisions.push({ id: `deal:${id}`, area: "deals", at: new Date(now).toISOString(), ok: false, f: [] });
  for (const o of Object.values(s.offers ?? {}).flat()) {
    const f = [feat(`great=${o.great ? "yes" : "no"}`, o.great ? "great deals" : "ordinary offers"), feat(`condition=${o.condition}`, `${o.condition} items`),
      feat(`site=${o.site}`, `offers on ${o.site}`), feat(`risks=${o.risks?.length ? "some" : "none"}`, o.risks?.length ? "offers with a warning" : "offers without warnings")];
    // shortcut: an offer he left on the board for a week counts as wanted (there is no "keep" click); add one if deals predictions stay noisy.
    if (now - Date.parse(o.firstSeen) > 7 * DAY) out.decisions.push({ id: `deal:${o.id}`, area: "deals", at: new Date(Date.parse(o.firstSeen) + 7 * DAY).toISOString(), ok: true, f });
    else out.pending.push({ id: `deal:${o.id}`, area: "deals", f });
  }
  return out;
}

/** Score decided guesses and guess new waiting items. At most once a minute per user; never throws (returns the stored guesses). */
export async function refreshPredictions(sb: SupabaseClient, userId: string, now = Date.now()): Promise<Prediction[]> {
  const at = (g.__orbitPredictAt ??= {});
  if (now - (at[userId] ?? 0) < FRESH_MS) return (await load()).users[userId]?.preds ?? [];
  at[userId] = now;
  const since = new Date(now - 180 * DAY).toISOString();
  const soft = (name: string) => (e: unknown) => { console.warn(`[predict] ${name} skipped:`, e instanceof Error ? e.message : e); return null; };
  const parts = await Promise.all([clips().catch(soft("clips")), proposals(sb, userId, since, now).catch(soft("proposals")), drafts(sb, userId, since).catch(soft("drafts")),
    hygiene(sb, userId, since).catch(soft("hygiene")), niches().catch(soft("niches")), deals(now).catch(soft("deals"))]);
  // A failed source must not look like "every item vanished": keep its open guesses untouched this round.
  const failed = new Set<PArea>((["clips", "proposals", "drafts", "hygiene", "niches", "deals"] as const).filter((_, i) => !parts[i]));
  const ok = parts.map((p) => p ?? none);
  try {
    return await update((s) => {
      const u = (s.users[userId] ??= { preds: [] });
      const held = u.preds.filter((x) => failed.has(x.area));
      u.preds = [...step(u.preds.filter((x) => !failed.has(x.area)), ok.flatMap((p) => p.decisions), ok.flatMap((p) => p.pending), now), ...held];
      return u.preds;
    });
  } catch (e) { console.error("[predict] not saved:", e instanceof Error ? e.message : e); return []; }
}

/** What the cards, ANALYTICS and the autonomy panel show. */
export async function predictionsView(sb: SupabaseClient, userId: string, now = Date.now()) {
  const preds = await refreshPredictions(sb, userId, now);
  const open = Object.fromEntries(preds.filter((x) => x.outcome === undefined).map((x) => [x.id, { p: x.p, why: x.why }]));
  return { open, week: score(preds, now, 7), month: score(preds, now, 30), eligible: eligible(preds) };
}

/** The weekly review's line ("" when nothing was decided or on any failure). */
export const predictionWeekLine = (sb: SupabaseClient, userId: string) => refreshPredictions(sb, userId).then((p) => weeklyLine(score(p, Date.now(), 7)), () => "");
