import { mkdir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { DEEP_MODEL, FAST_MODEL, LOCAL_MODEL, MODEL, SMART_MODEL } from "./claude";
import { modelCalls, usageView } from "./usage-meter";
import { redact } from "./health-pure";
import { quietAt } from "./remote-push-pure";
import { OLLAMA_URL, localStatus } from "./local-model-pure";
import { ackIncident, budget, failedJobs, mergeServices, modelRows, parseStore, problems, reconcile, sortIncidents, storageRow, type Failure, type Probe } from "./system-health-pure";

// System health (roadmap 9.5), IO. Rules: system-health-pure.ts. Read-only except its own store (<ORBIT data dir>/system-health.json)
// and one phone push per new incident through the existing push path (pushNotify("health"): fixed label, rate limit, quiet hours).
// Every probe is local or a read ORBIT already does (Supabase select, calendar events, Ollama on localhost); nothing new goes outward.

const file = () => path.join(orbitDataDir(), "system-health.json");
const CHECK_MS = 10 * 60_000, WEEK = 7 * 86_400_000;
const g = globalThis as unknown as { __orbitSysHealth?: Promise<unknown> };
const iso = (t: number | null | undefined) => (t ? new Date(t).toISOString() : null);
const msg = (e: unknown) => redact(e instanceof Error ? e.message : String(e)).slice(0, 160);

const load = async () => parseStore(await readFile(file(), "utf8").catch(() => null));
/** Store edits run one after another (the scheduler tick and the doctor view may overlap). */
function update<T>(fn: (s: Awaited<ReturnType<typeof load>>) => T | Promise<T>): Promise<T> {
  const run = (g.__orbitSysHealth ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load(), r = await fn(s);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s));
    await rename(file() + ".tmp", file());
    return r;
  });
  g.__orbitSysHealth = run;
  return run;
}

/** Free bytes on the drive holding dir (its nearest existing parent when it isn't created yet); null when unreadable. */
async function free(dir: string): Promise<number | null> {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    const s = await statfs(d).catch(() => null);
    if (s) return s.bavail * s.bsize;
    if (path.dirname(d) === d) return null;
  }
}

const within = <T>(p: Promise<T>, ms = 6000) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`no answer within ${ms / 1000} s`)), ms).unref?.())]);

async function probes(sb: SupabaseClient, events: { type: string; created_at: string; payload: Record<string, unknown> }[], now: number): Promise<Probe[]> {
  const u = usageView(), calls = modelCalls(), lastClaude = calls.filter((c) => c.ok).at(-1)?.at ?? null, lastCall = calls.at(-1);
  const [db, cal, local, push, stories] = await Promise.all([
    within(Promise.resolve(sb.from("profiles").select("id", { head: true }).limit(1))).then((r) => (r.error ? r.error.message : ""), msg),
    import("./gcal").then(async (m) => ((await m.readCal()) ? within(m.calendarEvents(1, now), 12_000).then(() => "", msg) : null)).catch(msg),
    LOCAL_MODEL ? fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) }).then((r) => r.json(), () => null).then((t) => localStatus(LOCAL_MODEL, t)) : null,
    import("./remote-push").then(async (m) => ({ problem: m.pushProblem(), last: m.lastPushOk(), phones: (await (await import("./remote")).listDevices()).filter((d) => d.push).length })).catch(() => null),
    import("./clips/story").then((m) => m.listStories()).catch(() => []),
  ]);
  const nowIso = iso(now)!;
  const sent = events.filter((e) => e.type === "business.stage" && e.payload?.to === "contacted").at(-1);
  const hfDone = stories.filter((s) => s.status === "done").sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1);
  const hfFail = stories.filter((s) => s.status === "failed").sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1);
  return [
    { id: "supabase", label: "Database (Supabase)", state: db ? "down" : "ok", detail: db ? `Can't reach it: ${db}` : "Reachable", okAt: db ? null : nowIso },
    { id: "claude", label: "Claude CLI login", okAt: iso(lastClaude),
      ...(u.limit ? { state: "down" as const, detail: `Usage limit reached until ${new Date(u.limit.until).toLocaleString()}` }
        : !lastCall ? { state: "off" as const, detail: "No Claude calls in the last 7 days" }
        : lastCall.ok ? { state: "ok" as const, detail: "Last call worked" }
        : { state: "down" as const, detail: "The last Claude call failed: open a terminal and run claude to check you're signed in" }) },
    process.env.RESEND_API_KEY && process.env.ORBIT_MAIL_FROM
      ? { id: "resend", label: "Email sending (Resend)", state: "ok", detail: sent ? "Set up" : "Set up; no email sent in the last 7 days", okAt: sent ? iso(Date.parse(sent.created_at)) : null }
      : { id: "resend", label: "Email sending (Resend)", state: "off", detail: "Not set up (RESEND_API_KEY, ORBIT_MAIL_FROM)" },
    { id: "higgsfield", label: "Higgsfield", state: stories.length ? "ok" : "off", okAt: hfDone?.updatedAt ?? null,
      detail: !stories.length ? "Not used yet" : hfFail && (!hfDone || hfFail.updatedAt > hfDone.updatedAt) ? `Last job failed: ${redact(hfFail.error?.message ?? hfFail.step).slice(0, 120)}` : "Last job worked" },
    !local || local.state === "off" ? { id: "ollama", label: "Local brain (Ollama)", state: "off", detail: "Off (ORBIT_LOCAL_MODEL empty)" }
      : { id: "ollama", label: "Local brain (Ollama)", state: local.state === "ok" ? "ok" : "down", detail: local.text, okAt: local.state === "ok" ? nowIso : null },
    !push ? { id: "push", label: "Phone push", state: "off", detail: "Couldn't read the paired devices" }
      : push.problem ? { id: "push", label: "Phone push", state: "off", detail: push.problem }
      : { id: "push", label: "Phone push", state: push.phones ? "ok" : "off", detail: push.phones ? `${push.phones} phone${push.phones > 1 ? "s" : ""} subscribed` : "No phone subscribed (open Remote on the phone and turn notifications on)", okAt: iso(push.last) },
    cal === null ? { id: "calendar", label: "Google Calendar", state: "off", detail: "Not connected" }
      : { id: "calendar", label: "Google Calendar", state: cal ? "down" : "ok", detail: cal ? `Read failed: ${cal}` : "Read works", okAt: cal ? null : nowIso },
  ];
}

async function failures(sb: SupabaseClient, userId: string, events: { type: string; created_at: string; payload: Record<string, unknown> }[], since: string): Promise<Failure[]> {
  const rows = <T>(q: PromiseLike<{ data: T[] | null }>) => Promise.resolve(q).then((r) => r.data ?? [], () => [] as T[]);
  const [tasks, missions, clips, stories] = await Promise.all([
    rows<{ title: string | null; agent: string; finished_at: string }>(sb.from("tasks").select("title, agent, finished_at").eq("user_id", userId).eq("status", "failed").gte("finished_at", since).limit(100)),
    rows<{ doc: { objective?: string } | null; updated_at: string }>(sb.from("missions").select("doc, updated_at").eq("user_id", userId).eq("status", "failed").gte("updated_at", since).limit(50)),
    import("./clips/factory").then((m) => m.listJobs()).catch(() => []),
    import("./clips/story").then((m) => m.listStories()).catch(() => []),
  ]);
  const cut = (s: string) => redact(s).slice(0, 120);
  return [
    ...tasks.map((t) => ({ kind: "task" as const, label: cut(`${t.agent}: ${t.title ?? "task"}`), at: t.finished_at })),
    ...missions.map((m) => ({ kind: "mission" as const, label: cut(m.doc?.objective ?? "mission"), at: m.updated_at })),
    ...events.filter((e) => e.type === "night.task" && e.payload?.status === "failed").map((e) => ({ kind: "night" as const, label: `${String(e.payload.kind)} task`, at: iso(Date.parse(e.created_at))! })),
    ...clips.filter((j) => j.status === "failed" && j.updatedAt >= since).map((j) => ({ kind: "clip" as const, label: cut(`clip job: ${j.error ?? j.step}`), at: j.updatedAt })),
    ...stories.filter((s) => s.status === "failed" && s.updatedAt >= since).map((s) => ({ kind: "clip" as const, label: cut(`AI Story: ${s.error?.message ?? s.step}`), at: s.updatedAt })),
  ];
}

/** Everything the SYSTEM card shows; remembers last successes. Incidents are only read here (the scheduler's check moves them). */
async function snapshot(sb: SupabaseClient, userId: string, now = Date.now()) {
  const since = iso(now - WEEK)!;
  const { data: ev } = await Promise.resolve(sb.from("events").select("type, created_at, payload").eq("user_id", userId).in("type", ["night.task", "business.stage"])
    .gte("created_at", since).order("created_at", { ascending: true }).limit(1000)).catch(() => ({ data: null }));
  const events = (ev ?? []) as { type: string; created_at: string; payload: Record<string, unknown> }[];
  const [{ vaultDir }, { studioRoot }, { backupDir }, story, night] = await Promise.all([import("./vault"), import("./clips/factory"), import("./backup"),
    import("./clips/story").then((m) => m.weekUsage()).catch(() => null), import("./night").then((m) => m.lastNightRun(userId)).catch(() => null)]);
  const dirs: [string, string, string][] = [["data", "ORBIT data folder", orbitDataDir()], ["vault", "VAULT", vaultDir()], ["studio", "STUDIO folder", studioRoot()], ["backup", "Backup folder", backupDir()]];
  const [pr, fails, storage, prev] = await Promise.all([probes(sb, events, now), failures(sb, userId, events, since),
    Promise.all(dirs.map(async ([id, label, dir]) => storageRow(id, label, dir, await free(dir)))), load()]);
  const { services, lastOk } = mergeServices(pr, prev.lastOk);
  const u = usageView(), weekly = Number(process.env.ORBIT_CLAUDE_WEEKLY_CALLS) || null;
  return {
    at: iso(now)!, lastOk, services, storage, failed: failedJobs(fails, now),
    models: modelRows({ main: MODEL, fast: FAST_MODEL, deep: DEEP_MODEL, smart: SMART_MODEL }, modelCalls(), !!u.limit, now),
    local: LOCAL_MODEL || null,
    usage: { h5: budget(u.h5.calls, u.settings.calls5h), d7: budget(u.d7.calls, weekly), limitUntil: u.limit?.until ?? null, hold: u.hold },
    higgsfield: story ? budget(story.used, story.cap) : null,
    night: night?.run ? { night: night.run.key, calls: budget(night.run.calls, night.settings.maxCalls), minutes: budget(Math.round(night.run.ms / 60_000), night.settings.maxMinutes), stopped: night.run.stopped ?? null } : null,
  };
}

/** GET for the doctor's SYSTEM card. */
export async function systemHealthView(sb: SupabaseClient, userId: string) {
  const s = await snapshot(sb, userId);
  const { incidents } = await update((st) => { st.lastOk = { ...st.lastOk, ...s.lastOk }; return st; });
  return { ...s, incidents: sortIncidents(incidents).slice(0, 20) };
}

/** Scheduler tick (every minute; works every 10). Opens/resolves incidents and pushes once per new one, outside quiet hours. Never throws. */
export async function tickSystemHealth(sb: SupabaseClient, userId: string) {
  try {
    if (Date.now() - (await load()).lastCheck < CHECK_MS) return;
    const s = await snapshot(sb, userId), now = Date.now();
    const alert = await update((st) => {
      const r = reconcile(st.incidents, problems(s.services, s.storage, s.usage.limitUntil), now, quietAt(now));
      Object.assign(st, { incidents: r.incidents, lastCheck: now, lastOk: { ...st.lastOk, ...s.lastOk } });
      return r.alert;
    });
    if (alert.length) (await import("./remote-push")).pushNotify("health"); // fixed label only: never the incident text
  } catch (e) { console.error("[orbit] system health check failed:", msg(e)); }
}

/** The owner's "Got it" on an incident. */
export const ackSystemIncident = (key: string) => update((st) => { st.incidents = ackIncident(st.incidents, key); return ""; });
/** Open (not acknowledged) incidents from the last check, without probing anything (ORBIT speaks first). */
export const openIncidents = async () => (await load()).incidents.filter((i) => i.state === "open");
