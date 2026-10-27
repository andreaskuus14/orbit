import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { logActivity } from "./activity.ts";
import { D7, H5, addCall, emptyMeter, holdReason, parseLimitError, parseMeter, patchSettings, usageLevel, windowStats, type Call, type Meter } from "./usage-meter-pure.ts";

// Usage meter store: <ORBIT data dir>/usage-meter.json, kept in memory and saved at most every 2 s (atomic tmp + rename).
// recordCall is called by claude.ts after every CLI call; usageHold() is what background lanes check before starting.

const file = () => path.join(orbitDataDir(), "usage-meter.json");
const g = globalThis as unknown as { __orbitMeter?: Meter; __orbitMeterSave?: { timer?: ReturnType<typeof setTimeout>; chain: Promise<unknown> } };
const W = (g.__orbitMeterSave ??= { chain: Promise.resolve() });

function meter(): Meter {
  if (!g.__orbitMeter) {
    try { g.__orbitMeter = parseMeter(readFileSync(file(), "utf8")); } catch { g.__orbitMeter = emptyMeter(); }
  }
  return g.__orbitMeter;
}

function save() {
  if (W.timer) return;
  W.timer = setTimeout(() => {
    W.timer = undefined;
    const text = JSON.stringify(meter());
    W.chain = W.chain.then(async () => {
      await mkdir(path.dirname(file()), { recursive: true });
      await writeFile(file() + ".tmp", text);
      await rename(file() + ".tmp", file());
    }).catch((e) => console.error("[orbit] usage meter not saved:", e instanceof Error ? e.message : e));
  }, 2000);
  W.timer.unref?.();
}

/** One finished CLI call. A failed one whose text is a usage/rate-limit error pauses background lanes until its reset time. Never throws. */
export function recordCall(c: Omit<Call, "at">, errText = "") {
  try {
    const now = Date.now(), m = meter();
    addCall(m, { ...c, at: now }, now);
    const until = c.ok ? null : parseLimitError(errText, now);
    if (until) {
      m.limit = { until, at: now, text: errText.slice(0, 300) };
      console.error(`[orbit] Claude usage limit reached; background work paused until ${new Date(until).toLocaleString()}`);
      logActivity({ area: "system", title: `Claude usage limit reached: background work paused until ${new Date(until).toLocaleString()}`, detail: errText.slice(0, 200) });
    }
    save();
  } catch (e) { console.error("[orbit] usage meter failed:", e); }
}

/** "" when background lanes (autopilot, goals, proactive, translate) may start a Claude call, else why not. */
export const usageHold = () => holdReason(meter(), Date.now());

/** A real usage/rate limit (not just heavy use) is active: nothing that calls Claude should start. */
export const usageLimited = () => { const l = meter().limit; return !!l && l.until > Date.now(); };

export function usageView() {
  const m = meter(), now = Date.now();
  return {
    h5: windowStats(m.calls, now, H5), d7: windowStats(m.calls, now, D7), level: usageLevel(m, now), settings: m.settings,
    limit: m.limit && m.limit.until > now ? m.limit : null, hold: holdReason(m, now),
  };
}

export function setUsageSettings(b: Record<string, unknown>): string {
  const m = meter(), next = patchSettings(b, m.settings);
  if (typeof next === "string") return next;
  m.settings = next;
  if (b.clearLimit === true) m.limit = null; // the owner knows the limit has reset
  save();
  return "";
}

/** Claude calls recorded since `t` (ms): the night shift measures its budget with it (it counts every overnight call, conservatively). */
export const callsSince = (t: number) => meter().calls.reduce((n, c) => n + (c.at >= t ? 1 : 0), 0);
/** Failed calls since `t` (ms), purpose and time only: the night health check counts them. */
export const failedCallsSince = (t: number) => meter().calls.filter((c) => !c.ok && c.at >= t).map((c) => ({ at: c.at, purpose: c.purpose }));
/** When the owner last talked to CORE (its calls use purposes starting "core"); 0 if not in the last 7 days. */
export const lastCoreCallAt = () => meter().calls.reduce((m, c) => (c.purpose.startsWith("core") && c.at > m ? c.at : m), 0);
/** The last 7 days of calls (time and cost only): the Money view folds them into ORBIT's own spend. */
export const meterCalls = () => meter().calls.map((c) => ({ at: c.at, cost: c.cost }));
/** The last 7 days of calls (time, model, ok): System health's model availability. */
export const modelCalls = () => meter().calls.map((c) => ({ at: c.at, model: c.model, ok: c.ok }));
