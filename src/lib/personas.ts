import { readStore, writeStore } from "./safe-file.ts";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, recordUsage } from "./claude";
import { SEED_WORLD, isActive, validateDevWorld, type DevWorld } from "./devworld-pure";
import { MAX_CONTEXT, WALK_SYSTEM, mergeMeasured, parseWalkthrough, pickMeasured, proposals, reportLine, scoreAll, walkthroughPrompt,
  type Measured, type PersonaResult, type Proposal, type Walkthrough } from "./personas-pure";

// Persona playtest runner (rules: personas-pure.ts). Night slot "personas" and POST /api/personas.
// 1. Measured: up to `studioRuns` look-only Studio playtests through the existing bridge (runPlaytest: start play, walk, look, console, stop),
//    each with one persona's goal. Skipped when the bridge isn't set up or Studio isn't open. Never edits the place.
// 2. Simulated: one model walkthrough of the game's DevWorld entry, open bugs, the owner's pasted UI text/scripts and the Studio log.
// 3. Scored here (pure) into the funnel, heatmap and backlog proposals. Proposals only enter the backlog when the owner clicks Add.
// State: <ORBIT data dir>/personas.json (per user: pasted context + the last report).

export type PersonaReport = {
  at: string; game: string; walk: Walkthrough; results: PersonaResult[]; proposals: Proposal[];
  measured: Measured[]; studio: string; line: string;
};
type Store = Record<string, { context?: string; report?: PersonaReport }>;

const file = () => path.join(orbitDataDir(), "personas.json");
const g = globalThis as unknown as { __orbitPersonas?: { busy: boolean; write: Promise<unknown> } };
const S = (g.__orbitPersonas ??= { busy: false, write: Promise.resolve() });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

const load = async (): Promise<Store> => { const t = await readStore(file()), j = t ? JSON.parse(t) : null; return j && typeof j === "object" ? j : {}; }; // missing = empty; locked/damaged throws
function update(fn: (s: Store) => void): Promise<void> {
  const p = S.write.catch(() => {}).then(async () => {
    const s = await load(); fn(s);
    await writeStore(file(), JSON.stringify(s));
  });
  S.write = p;
  return p;
}

export const personaView = async (userId: string) => { const u = (await load())[userId] ?? {}; return { context: u.context ?? "", report: u.report ?? null, running: S.busy }; };
export const setPersonaContext = (userId: string, context: string) => update((s) => { (s[userId] ??= {}).context = context.slice(0, MAX_CONTEXT); });
/** Due for the night shift: no report in the last 20 hours. */
export const personasDue = async (userId: string, now = Date.now()) => !S.busy && !(now - Date.parse((await load())[userId]?.report?.at ?? "") < 20 * 3_600_000);

export class PersonaBusyError extends Error {}

/** One full persona playtest. `studioRuns` 0 = simulated only. Throws when the walkthrough can't be read. */
export async function runPersonaPlaytest(sb: SupabaseClient, userId: string, opts: { studioRuns: number; day: string; signal?: AbortSignal }): Promise<PersonaReport> {
  if (S.busy) throw new PersonaBusyError("A persona playtest is already running.");
  S.busy = true;
  try {
    const world = await devWorld(sb, userId);
    const game = world.games.find((x) => x.id === "pet-sim") ?? world.games.find((x) => x.platform === "roblox") ?? world.games[0];
    if (!game) throw new Error("No game in GAME DEV to playtest.");
    const { measured, studio } = await studioRuns(sb, userId, opts.studioRuns, opts.day, opts.signal);
    opts.signal?.throwIfAborted();
    const log = await import("./dev-session").then((m) => m.listDevSessions(sb, userId)).then((ss) => ss.flatMap((s) => s.events).slice(-20)
      .map((e) => `${e.source}: ${e.label}${e.ok ? "" : " (failed)"}${e.errors.length ? ` errors: ${e.errors.slice(0, 2).join(" | ")}` : ""}${e.changes.length ? ` changed: ${e.changes.map((c) => c.name).slice(0, 5).join(", ")}` : ""}`), () => []);
    const econ = await import("./economy").then((m) => m.economyContextFor(userId), () => ""); // economy personas: free / small spender / whale
    const context = [econ, (await load())[userId]?.context ?? ""].filter(Boolean).join("\n\n");
    const r = await askClaude(walkthroughPrompt({ game, bugs: world.bugs.filter((b) => b.game === game.id && isActive(b)).map((b) => b.title), context, log, runs: measured }), WALK_SYSTEM,
      { lane: "background", purpose: "personas.walkthrough", timeoutMs: 240_000, signal: opts.signal });
    await recordUsage(sb, userId, "personas.walkthrough", r);
    const parsed = parseWalkthrough(r.text);
    if (!parsed) throw new Error("Couldn't read the walkthrough from the model.");
    const walk = mergeMeasured(parsed, measured), results = scoreAll(walk);
    const report: PersonaReport = { at: new Date().toISOString(), game: game.name, walk, results, proposals: proposals(walk, results), measured, studio, line: reportLine(results, measured.filter((m) => m.done).length) };
    await update((s) => { (s[userId] ??= {}).report = report; });
    return report;
  } finally { S.busy = false; }
}

async function devWorld(sb: SupabaseClient, userId: string): Promise<DevWorld> {
  const { data } = await sb.from("game_saves").select("save").eq("user_id", userId).eq("game", "devworld").maybeSingle();
  const v = data?.save ? validateDevWorld(data.save) : null;
  return v?.ok ? v.world : SEED_WORLD;
}

/** Look-only Studio playtests for tonight's rotated personas; each goes into the GAME DEV session log like a manual playtest. */
async function studioRuns(sb: SupabaseClient, userId: string, k: number, day: string, signal?: AbortSignal): Promise<{ measured: Measured[]; studio: string }> {
  if (k <= 0) return { measured: [], studio: "Studio not used (simulated only)." };
  const rbx = await import("./roblox");
  if (!rbx.robloxConfig().configured) return { measured: [], studio: "Roblox Studio bridge isn't set up: everything is simulated." };
  const st = await rbx.studioStatus();
  if (!st.open) return { measured: [], studio: `Studio wasn't open (${st.notes || "no answer"}): everything is simulated.` };
  const [{ recordDevEvent }, { eventFromPlaytest, eventFailed }] = await Promise.all([import("./dev-session"), import("./dev-session-pure")]);
  const measured: Measured[] = [], problems: string[] = [];
  for (const p of pickMeasured(day, k)) {
    if (signal?.aborted) break;
    const goal = p.studio.goal, label = `Persona playtest: ${p.name} (${p.type})`;
    try {
      const r = await rbx.runPlaytest(goal);
      void recordDevEvent(sb, userId, { ...eventFromPlaytest(goal, r), label }, r.image);
      measured.push({ persona: p.id, stage: p.studio.stage, goal, done: r.done, findings: r.findings, consoleErrors: r.consoleErrors, notes: r.notes });
    } catch (e) {
      problems.push(`${p.name}: ${msg(e)}`);
      if (!(e instanceof rbx.RobloxBusyError)) void recordDevEvent(sb, userId, eventFailed("playtest", label, msg(e)));
    }
  }
  const ok = measured.filter((m) => m.done).length;
  return { measured, studio: `${ok} of ${measured.length + problems.length} Studio run${measured.length + problems.length === 1 ? "" : "s"} finished in ${st.place || "Studio"}.${problems.length ? ` Problems: ${problems.join("; ")}` : ""}` };
}
