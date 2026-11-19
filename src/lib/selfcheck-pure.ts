// Daily self-check (reliability M2), pure part; tested in tests/selfcheck.test.ts. IO: selfcheck.ts, run from the scheduler tick.
// Once a Europe/Tallinn day (from 09:00, never in quiet hours) ORBIT runs its own doctor and sends ONE phone push (the fixed
// "health" label, no check text) only when something fails that didn't fail in the previous run. A failure that stays broken
// doesn't push again; once it recovers and breaks again, it does.
import type { Check } from "./doctor-pure.ts";
import { DEFAULT_QUIET, quietAt, type Quiet } from "./remote-push-pure.ts";

export type SelfCheckState = { day?: string; failing?: string[]; at?: string; pushed?: string };
export const SELFCHECK_HOUR = 9; // Tallinn: after the 07:30 brief and quiet hours, before the 10:30 daily digest
const DAY = 86_400_000;

/** YYYY-MM-DD in Tallinn. */
export const tallinnDay = (now: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Tallinn", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const tallinnHour = (now: number) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Tallinn", hour: "2-digit", hourCycle: "h23" }).format(now));

/** Due: not run yet this Tallinn day, it is SELFCHECK_HOUR or later, and not quiet hours. ORBIT_SELFCHECK=off turns it off. */
export function selfCheckDue(st: SelfCheckState, now: number, q: Quiet = DEFAULT_QUIET, env?: string): boolean {
  if (/^(off|0|false|no)$/i.test((env ?? "").trim())) return false;
  return st.day !== tallinnDay(now) && tallinnHour(now) >= SELFCHECK_HOUR && !quietAt(now, q);
}

/** What counts as a failure worth a push: any "fail", plus a production update that failed to build (the doctor shows that as a
 *  warning because the previous version keeps running, but nobody notices it otherwise). */
export const alertable = (c: Check) => c.status === "fail" || (c.id === "build" && c.status === "warn" && /failed to build/.test(c.detail));

/** The run's outcome: ids failing now, the new ones (not failing last run, and not in `skip`: already pushed by their own
 *  path, e.g. the usage meter's "login" push), whether to push, and the state to save. */
export function selfCheckPlan(prev: SelfCheckState, checks: Check[], now: number, skip: string[] = []) {
  const failing = [...new Set(checks.filter(alertable).map((c) => c.id))].sort();
  const before = new Set(prev.failing ?? []);
  const fresh = failing.filter((id) => !before.has(id) && !skip.includes(id));
  const at = new Date(now).toISOString();
  return { failing, fresh, push: fresh.length > 0, state: { day: tallinnDay(now), failing, at, ...(fresh.length ? { pushed: at } : prev.pushed ? { pushed: prev.pushed } : {}) } as SelfCheckState };
}

/** One tiny login probe a day, only when nothing proves the login either way: no Claude call worked in the last 24 h and no
 *  login outage is already open (that one has its own 15-minute probe), and no usage limit is holding calls. */
export const probeWanted = (calls: { at: number; ok: boolean }[], now: number, loginDown: boolean, limited: boolean) =>
  !loginDown && !limited && !calls.some((c) => c.ok && now - c.at < DAY);

/** State file → state; anything unreadable is a fresh start (worst case: one extra push). */
export function parseSelfCheck(text: string | null): SelfCheckState {
  try {
    const o = JSON.parse(text ?? "") as SelfCheckState;
    if (!o || typeof o !== "object") return {};
    return { ...(typeof o.day === "string" ? { day: o.day } : {}), ...(Array.isArray(o.failing) ? { failing: o.failing.filter((x) => typeof x === "string").slice(0, 100) } : {}),
      ...(typeof o.at === "string" ? { at: o.at } : {}), ...(typeof o.pushed === "string" ? { pushed: o.pushed } : {}) };
  } catch { return {}; }
}
