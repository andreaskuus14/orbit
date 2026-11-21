// RED-TEAM TWIN, IO side (rules and cases: redteam-pure.ts). Runs the self-attack once a night from the scheduler tick (and on
// "Run now" in OPERATIONS → Safety), saves the report, logs failures to Activity and hands them to night repair as signals.
// It never touches the outside world: cases only ask ORBIT's guards what they would allow. Default model: the mocked obedient
// model. Live mode (ORBIT_REDTEAM_LIVE=1, off by default) also asks the small LOCAL model (Ollama on loopback, local-llm.ts) for
// the injection/exfil cases; it never calls Claude, Haiku or any hosted model, and it sends only the synthetic attack text.
// State: <ORBIT data dir>/redteam.json (last 14 reports).
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { orbitDataDir } from "./data-dir";
import { readStore, writeStore } from "./safe-file";
import { logActivity } from "./activity";
import { CASES, LIVE_SYSTEM, obedientModel, parseCall, runCases, type Case, type Model, type Report } from "./redteam-pure";

const file = () => path.join(orbitDataDir(), "redteam.json");
const KEEP = 14;
type State = { reports: Report[] };
const g = globalThis as unknown as { __orbitRedTeam?: Promise<Report> | null };

async function load(): Promise<State> {
  try { const s = JSON.parse(await readStore(file())) as State; return Array.isArray(s?.reports) ? s : { reports: [] }; } catch { return { reports: [] }; }
}
export const lastReport = async (): Promise<Report | null> => (await load()).reports.at(-1) ?? null;

/** The live local model as a red-team target; null when it isn't available (the run then stays mock-only). */
async function liveModel(): Promise<{ model: Model; name: string } | null> {
  const ll = await import("./local-llm");
  const pick = await ll.resolveLocalModel().catch(() => null);
  if (!pick?.model) return null;
  return { name: pick.model, model: async (system, content) => parseCall((await ll.chatLocal(content.slice(0, 6000), system, { timeoutMs: 60_000, numCtx: 4096 })).text) };
}

/** One run. live: also the local model (only the cases that use a model). Never throws; one run at a time. */
export function runRedTeam(o: { live?: boolean } = {}): Promise<Report> {
  g.__orbitRedTeam ??= (async () => {
    let r = await runCases(CASES, obedientModel, "mock");
    if (o.live ?? process.env.ORBIT_REDTEAM_LIVE === "1") {
      const lm = await liveModel().catch(() => null);
      if (lm) {
        const live = await runCases(CASES.filter((c: Case) => c.usesModel), lm.model, "live");
        r = { ...r, mode: "live", model: lm.name, total: r.total + live.total, passed: r.passed + live.passed, failed: [...r.failed, ...live.failed.map((f) => ({ ...f, id: `live:${f.id}` }))], ms: r.ms + live.ms };
      }
    }
    const s = await load();
    await mkdir(orbitDataDir(), { recursive: true });
    await writeStore(file(), JSON.stringify({ reports: [...s.reports, r].slice(-KEEP) }));
    logActivity({ area: "system", title: r.failed.length ? `Self-attack: ${r.failed.length} of ${r.total} attacks got through` : `Self-attack: all ${r.total} attacks stopped`,
      detail: r.failed.length ? r.failed.slice(0, 3).map((f) => f.attack).join(" · ").slice(0, 480) : `${r.mode} run, ${r.ms} ms` });
    return r;
  })().finally(() => { g.__orbitRedTeam = null; });
  return g.__orbitRedTeam;
}

/** Scheduler tick: once a day, from 03:00 local time (before night repair ranks its signals). Never throws. */
export async function maybeRedTeam(now = new Date()): Promise<void> {
  try {
    if (now.getHours() < 3) return;
    const last = await lastReport(), day = now.toLocaleDateString("sv-SE");
    if (last && new Date(last.at).toLocaleDateString("sv-SE") === day) return;
    await runRedTeam();
  } catch (e) { console.error("[orbit] red-team run failed:", e instanceof Error ? e.message : e); }
}
