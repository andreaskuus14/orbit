import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { readStore, writeStore } from "./safe-file";
import { parseQuiet } from "./remote-push-pure";
import { parseSelfCheck, probeWanted, selfCheckDue, selfCheckPlan, tallinnDay, type SelfCheckState } from "./selfcheck-pure";

// Daily self-check (reliability M2), IO. Rules: selfcheck-pure.ts. Called by the scheduler tick (scheduler.ts), so it inherits
// Stop-all. Store: <ORBIT data dir>/selfcheck.json (the day it ran, which checks failed). The day is saved before the run, so a
// crash mid-run never makes it run (or push) again the same day. The push is the fixed "health" label: no check text leaves the PC.

const file = () => path.join(orbitDataDir(), "selfcheck.json");
const g = globalThis as unknown as { __orbitSelfCheck?: boolean };

export async function maybeSelfCheck(sb: SupabaseClient, now = Date.now()): Promise<void> {
  if (g.__orbitSelfCheck) return; // a run takes up to ~10 s (the doctor's guards), the tick is every minute
  g.__orbitSelfCheck = true;
  try {
    const prev: SelfCheckState = parseSelfCheck(await readStore(file()));
    if (!selfCheckDue(prev, now, parseQuiet(process.env.ORBIT_QUIET_HOURS), process.env.ORBIT_SELFCHECK)) return;
    await writeStore(file(), JSON.stringify({ ...prev, day: tallinnDay(now) })); // no save, no run
    const meter = await import("./usage-meter");
    // Nothing proved the login in a day (ORBIT idle): one tiny call. A sign-in failure is recorded by the usage meter (its own
    // outage, push and 15-minute probe); the doctor below then reads it.
    if (probeWanted(meter.modelCalls(), now, meter.loginDown(), meter.usageLimited())) {
      await import("./claude").then((c) => c.askClaude("Reply with OK.", "", { lane: "foreground", model: c.FAST_MODEL, purpose: "selfcheck.probe", timeoutMs: 60_000 })).catch(() => {});
    }
    const report = await (await import("./doctor")).runDoctor(sb);
    const plan = selfCheckPlan(prev, report.checks, Date.now(), meter.loginDown() ? ["claude"] : []); // the meter already pushed "login" for this outage
    await writeStore(file(), JSON.stringify(plan.state));
    const labels = report.checks.filter((c) => plan.fresh.includes(c.id)).map((c) => c.label);
    console.log(`[orbit] daily self-check: ${report.headline}${labels.length ? ` New: ${labels.join(", ")}` : ""}`);
    if (plan.fresh.length) (await import("./activity")).logActivity({ area: "system", title: `Daily self-check: new problem${labels.length > 1 ? "s" : ""}: ${labels.join(", ").slice(0, 200)}` });
    if (plan.push) (await import("./remote-push")).pushNotify("health"); // fixed label only (rate limit, quiet hours, Stop-all in its own path)
  } catch (e) {
    console.error("[orbit] daily self-check failed:", e instanceof Error ? e.message : e);
  } finally {
    g.__orbitSelfCheck = false;
  }
}
