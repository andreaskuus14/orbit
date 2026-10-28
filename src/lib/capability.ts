import type { Check } from "./doctor-pure";
import type { Lang } from "./i18n-pure";
import { cantDo, coreNote, evaluate, guessLang, missingFor, routedModules, startCheck, type Facts } from "./capability-pure";

// "Check before promising", IO (rules: capability-pure.ts). No new probes: the doctor's last checks (remembered by runDoctor), env names,
// and local connection files ORBIT already reads (YouTube/Calendar tokens, paired phones).

const g = globalThis as unknown as { __orbitCapChecks?: { at: number; checks: Check[] } };
const FRESH_MS = 15 * 60_000; // older doctor results count as unknown (never block), so a boot-time failure can't block forever

/** Called by runDoctor with every fresh report. */
export const rememberChecks = (checks: Check[]) => { g.__orbitCapChecks = { at: Date.now(), checks }; };

async function facts(checks?: Check[]): Promise<Facts> {
  const c = g.__orbitCapChecks;
  const list = checks ?? (c && Date.now() - c.at < FRESH_MS ? c.checks : []);
  const [yt, cal, push, devices] = await Promise.all([
    import("./yt-oauth").then(async (m) => ({ stored: !!(await m.readStored()), expired: m.wasExpired() })).catch(() => ({ stored: false, expired: false })),
    import("./gcal").then(async (m) => !!(await m.readCal())).catch(() => false),
    import("./remote-push").then((m) => m.pushProblem() || null).catch((e: unknown) => String(e)),
    import("./remote").then((m) => m.listDevices()).catch(() => []),
  ]);
  return { checks: Object.fromEntries(list.map((x) => [x.id, x.status])), env: process.env, ytConnected: yt.stored, ytExpired: yt.expired, calendar: cal,
    pushProblem: push, phones: devices.filter((d) => d.push).length };
}

export const capabilityState = async (checks?: Check[]) => evaluate(await facts(checks));
/** Doctor panel: every capability that's missing (the panel renders label/why/fix in its language). */
export const cantDoNow = async (checks: Check[]) => cantDo(await capabilityState(checks));
/** CORE prompt line for this turn's text (request + CORE's last reply), or "". Never throws. */
export const coreCapabilityNote = (text: string) => capabilityState().then((s) => coreNote(missingFor(text, s, routedModules(text))), () => "");
/** Mission/agent start: block (only when Claude Code is known down) and a heads-up note for anything else missing.
 *  Never throws (a broken check never blocks). */
export async function capabilityStart(text: string, lang?: Lang): Promise<{ block: string; headsUp: string }> {
  try { return startCheck(missingFor(text, await capabilityState()), lang ?? guessLang(text)); }
  catch { return { block: "", headsUp: "" }; }
}
