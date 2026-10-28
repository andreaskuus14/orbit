// "ORBIT speaks first" (roadmap 8, 2.2), pure part: when the owner comes back to the PC (first input after ≥ 20 min away,
// page visible), ORBIT may say ONE short line about the single most important thing. Caps: 4 a day, never 23–08, never during
// a call / conversation mode / focus timer, never when muted (Herald mute or snooze) or under Stop-all, never when he turned it off.
// The same item is never raised twice in a day. Voice only when the voice "speak" setting is on; the line is shown either way.
// No DOM, no Node APIs. Tested in tests/speak-first.test.ts.
import { localParts, quietHour } from "./call-pure.ts";
import { translate, type Lang } from "./i18n-pure.ts";
import type { Commitment } from "./dayplan-pure.ts";

export const SPEAK_FIRST = { awayMs: 20 * 60_000, maxPerDay: 4, approvalMs: 2 * 3600_000, meetingMs: 30 * 60_000 } as const;
export const SPEAK_FIRST_KEY = "orbit.speak-first.v1"; // localStorage: SpeakFirstState

/** on: the Settings toggle (default on). day/count/said: today's lines and the item keys already raised today.
 *  seen: approval id → when this PC first saw it waiting (approvals carry no timestamp of their own). */
export type SpeakFirstState = { on: boolean; day: string; count: number; said: string[]; seen: Record<string, number> };
export const SPEAK_FIRST_START: SpeakFirstState = { on: true, day: "", count: 0, said: [], seen: {} };

export function parseSpeakFirst(raw: string | null): SpeakFirstState {
  let o: Record<string, unknown> = {};
  try { const v = JSON.parse(raw ?? ""); if (v && typeof v === "object" && !Array.isArray(v)) o = v; } catch { /* fresh */ }
  return {
    on: o.on !== false,
    day: typeof o.day === "string" ? o.day : "",
    count: typeof o.count === "number" && Number.isFinite(o.count) ? o.count : 0,
    said: Array.isArray(o.said) ? o.said.filter((x): x is string => typeof x === "string").slice(-50) : [],
    seen: o.seen && typeof o.seen === "object" ? Object.fromEntries(Object.entries(o.seen).filter(([, v]) => typeof v === "number" && Number.isFinite(v))) as Record<string, number> : {},
  };
}

/** Approvals waiting now → first-seen times (kept for ids still waiting, new ids start now) and the approvals with their since. */
export function trackApprovals(seen: Record<string, number>, waiting: { id: string; title: string }[], now: number) {
  const next = Object.fromEntries(waiting.map((a) => [a.id, seen[a.id] ?? now]));
  return { seen: next, approvals: waiting.map((a) => ({ id: a.id, title: a.title, since: next[a.id] })) };
}

export type MomentKind = "incident" | "meeting" | "approval" | "loop" | "brief";
/** lastInputAt: his previous input before this one (0 = unknown, never a return). Item titles are data, already in the UI language. */
export type MomentSignals = {
  now: number; lastInputAt: number; visible: boolean;
  stopAll: boolean; muted: boolean; inCall: boolean; conversation: boolean; focus: boolean; speak: boolean;
  incidents?: { key: string; title: string }[]; // open, not acknowledged (system-health)
  events?: { title: string; start: string; allDay: boolean }[]; // the calendar read (gcal-pure CalEvent)
  approvals?: { id: string; title: string; since: number }[]; // waiting for his click, since = when it started waiting
  loopsToday?: { key: string; title: string }[]; // open loops due today
  briefUnseen?: boolean; // today's morning brief not opened yet
};
export type Moment = { kind: MomentKind; key: string; line: string; voice: boolean };

const clip = (t: string) => { const s = t.replace(/[“”"]/g, "").replace(/\s+/g, " ").trim(); return s.length > 80 ? `${s.slice(0, 79)}…` : s; };

/** One input event: the next state and the line to say, or null. Blocked moments use nothing up. */
export function decideMoment(prev: SpeakFirstState, sig: MomentSignals, lang: Lang = "en"): { state: SpeakFirstState; moment: Moment | null } {
  const { now } = sig, { day, h } = localParts(now);
  const st = prev.day === day ? prev : { ...prev, day, count: 0, said: [] };
  const none = { state: st, moment: null };
  const returned = sig.lastInputAt > 0 && now - sig.lastInputAt >= SPEAK_FIRST.awayMs;
  if (!st.on || !returned || !sig.visible || quietHour(h) || st.count >= SPEAK_FIRST.maxPerDay
    || sig.stopAll || sig.muted || sig.inCall || sig.conversation || sig.focus) return none;

  const fresh = <X>(key: (x: X) => string) => (x: X) => !st.said.includes(key(x));
  const inc = sig.incidents?.find(fresh((i) => `inc:${i.key}`));
  const meet = (sig.events ?? []).filter((e) => !e.allDay)
    .map((e) => ({ e, ms: Date.parse(e.start) - now })).filter(({ ms }) => ms > 0 && ms <= SPEAK_FIRST.meetingMs)
    .sort((a, b) => a.ms - b.ms).find(fresh(({ e }) => `meet:${e.start}:${e.title}`));
  const appr = (sig.approvals ?? []).filter((a) => now - a.since >= SPEAK_FIRST.approvalMs).sort((a, b) => a.since - b.since).find(fresh((a) => `appr:${a.id}`));
  const loop = sig.loopsToday?.find(fresh((l) => `loop:${l.key}`));
  const brief = sig.briefUnseen && !st.said.includes(`brief:${day}`);

  const tx = (k: "sf.incident" | "sf.meeting" | "sf.approval" | "sf.loop" | "sf.brief", t = "", n = 0) => translate(lang, k, { t: clip(t), n });
  const pick: [MomentKind, string, string] | null =
    inc ? ["incident", `inc:${inc.key}`, tx("sf.incident", inc.title)]
    : meet ? ["meeting", `meet:${meet.e.start}:${meet.e.title}`, tx("sf.meeting", meet.e.title, Math.max(1, Math.round(meet.ms / 60_000)))]
    : appr ? ["approval", `appr:${appr.id}`, tx("sf.approval", appr.title, Math.floor((now - appr.since) / 3600_000))]
    : loop ? ["loop", `loop:${loop.key}`, tx("sf.loop", loop.title)]
    : brief ? ["brief", `brief:${day}`, tx("sf.brief")]
    : null;
  if (!pick) return none;
  const [kind, key, text] = pick;
  return { state: { ...st, count: st.count + 1, said: [...st.said, key].slice(-50) }, moment: { kind, key, line: `${translate(lang, "sf.hi")} ${text}`, voice: sig.speak } };
}

/** Loops due today: his own confirmed commitment-inbox items whose due day is today (open loops only list them once overdue). */
export const loopsDueToday = (inbox: Pick<Commitment, "id" | "text" | "owner" | "due" | "status">[], today: string) =>
  inbox.filter((c) => c.status === "confirmed" && c.owner === "me" && c.due === today).map((c) => ({ key: `commit:${c.id}`, title: c.text }));
