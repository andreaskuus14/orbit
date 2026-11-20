// Usage pacer (pure, tested in tests/usage-pace.test.ts): background Claude work is polite about the owner's Max capacity.
// 1. Presence: while he is actively using ORBIT (UI input heartbeat, CORE turns, voice in the last 15 min) background lanes run only
//    while the 5-hour window is well under his soft budget, so his own CORE / Roblox / ARCH work keeps the headroom.
// 2. Pre-morning: in the lead window before his usual morning start (default 2 h before 07:30, Europe/Tallinn) heavy background
//    model work waits, so the window is fresh when he sits down. The morning brief itself is not gated by this.
// Owner-initiated (foreground) calls are never held by either rule (usage-meter.ts: usageHoldFor("foreground") = the provider limit only).
// Wired into holdReason(), so every background lane that checks usageHold() / usageHoldFor("background") is paced, and the lanes that
// already have the local Ollama path (withLocal in claude.ts) go local while held instead of just waiting.

export const PRESENT_MS = 15 * 60_000; // "active" = any signal this recent
export const PRESENT_BUDGET_PCT = 50; // while active, background runs only below this share of the soft 5-hour budget
export const DEFAULT_MORNING = "07:30"; // the morning brief slot (Tallinn); his usual morning start
export const DEFAULT_FRESH_LEAD_MIN = 120; // heavy background work waits this long before morningAt
export const MAX_FRESH_LEAD_MIN = 360;
export const PACE_TZ = "Europe/Tallinn";
export const BEAT_MS = 60_000; // the client heartbeat sends at most this often

/** Last-activity timestamps (ms epoch) from the places ORBIT can see him: UI input heartbeat, CORE turns, voice. */
export type PresenceSig = { ui?: number; core?: number; voice?: number };
export type PaceCtx = { sig?: PresenceSig };
export type PaceInput = { now: number; pct: number; sig?: PresenceSig; morningAt?: string; freshLeadMin?: number };
export type Pace = { kind: "active" | "fresh"; reason: string; until?: string };

/** Most recent usable signal. A stamp more than a minute in the future (clock jump) is ignored. */
export const lastActiveAt = (sig: PresenceSig | undefined, now: number): number =>
  [sig?.ui, sig?.core, sig?.voice].reduce<number>((m, t) => (typeof t === "number" && Number.isFinite(t) && t <= now + 60_000 && t > m ? t : m), 0);

export const isPresent = (sig: PresenceSig | undefined, now: number): boolean => { const t = lastActiveAt(sig, now); return t > 0 && now - t < PRESENT_MS; };

/** "HH:MM" → minutes since midnight, or NaN. */
export const hmToMin = (s: string): number => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s); return m ? +m[1] * 60 + +m[2] : NaN; };

/** Minutes since midnight in Europe/Tallinn (DST included). */
export function tallinnMinutes(now: number): number {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: PACE_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  return Number(p.find((x) => x.type === "hour")?.value) * 60 + Number(p.find((x) => x.type === "minute")?.value);
}

/** Is `now` inside [morningAt - leadMin, morningAt) Tallinn time (wraps midnight: 00:30 - 2 h = 22:30)? leadMin 0 = off. */
export function inFreshWindow(now: number, morningAt: string = DEFAULT_MORNING, leadMin: number = DEFAULT_FRESH_LEAD_MIN): boolean {
  const end = hmToMin(morningAt);
  if (Number.isNaN(end) || !(leadMin > 0)) return false;
  const lead = Math.min(Math.floor(leadMin), MAX_FRESH_LEAD_MIN), start = (end - lead + 1440) % 1440, t = tallinnMinutes(now);
  return start <= end ? t >= start && t < end : t >= start || t < end;
}

export const ACTIVE_REASON = "You're active: background work is holding Claude capacity for you";
export const freshReason = (until: string) => `Keeping your window fresh until ${until}`;

/** Why the pacer holds background work right now, or null. The fresh window wins over presence (it holds regardless of budget). */
export function paceHold(i: PaceInput): Pace | null {
  const morning = i.morningAt ?? DEFAULT_MORNING;
  if (inFreshWindow(i.now, morning, i.freshLeadMin ?? DEFAULT_FRESH_LEAD_MIN)) return { kind: "fresh", reason: freshReason(morning), until: morning };
  if (isPresent(i.sig, i.now) && i.pct >= PRESENT_BUDGET_PCT) return { kind: "active", reason: ACTIVE_REASON };
  return null;
}

/** The hold text for a pace verdict (the UI shows its translated version when the server's hold is exactly this). */
export const paceReason = (p: { kind: "active" | "fresh"; until?: string | null }) => (p.kind === "fresh" ? freshReason(p.until ?? DEFAULT_MORNING) : ACTIVE_REASON);

/** Client heartbeat: send when the tab is visible and the last beat is older than BEAT_MS. */
export const beatDue = (now: number, lastBeat: number, visible: boolean): boolean => visible && now - lastBeat >= BEAT_MS;
