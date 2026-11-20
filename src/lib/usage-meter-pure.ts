// Max-plan usage meter: pure parts (rolling windows, heavy-use backoff, rate-limit error parsing), tested in tests/usage-meter.test.ts.
// Every `claude -p` call is recorded by claude.ts → usage-meter.ts. Max limits are rolling windows (5 h and 7 days) whose exact
// sizes aren't public, so the owner sets his own 5-hour budget (calls and/or tokens); background lanes back off near it.
// usage-pace-pure.ts adds presence-aware reservation and the pre-morning fresh window on top (holdReason's ctx).
import { DEFAULT_FRESH_LEAD_MIN, DEFAULT_MORNING, MAX_FRESH_LEAD_MIN, hmToMin, paceHold, type Pace, type PaceCtx } from "./usage-pace-pure.ts";

/** The Claude CLI's sign-in is gone or expired (seen live: "Failed to authenticate: OAuth session expired and could not be refreshed").
 *  One rule for CORE's message, failure reports and the background pause. */
export const loginFailed = (text: string) =>
  /failed to authenticate|oauth (?:token|session)|session expired|could not be refreshed|\/login|not logged in|not signed in|invalid api key|token (?:has )?expired|authentication_failed/i.test(text);

export type Call = { at: number; purpose: string; model: string; inTok: number; outTok: number; ms: number; turns?: number; cost?: number; ok: boolean };
// tokens5h 0 = no token budget. morningAt: his usual morning start (Tallinn HH:MM); freshLeadMin: heavy background work waits this long
// before it (0 = off). Both optional: older saved meters and tests without them get the defaults.
export type MeterSettings = { calls5h: number; tokens5h: number; warnPct: number; morningAt?: string; freshLeadMin?: number };
export type Limit = { until: number; at: number; text: string };
export type Login = { at: number; probed: number; text: string };
export type Meter = { calls: Call[]; settings: MeterSettings; limit: Limit | null; login?: Login | null };

export const H5 = 5 * 3_600_000;
export const D7 = 7 * 86_400_000;
export const MAX_CALLS = 20_000;
export const LIMIT_PAUSE_MS = 30 * 60_000; // a limit error without a reset time pauses background work this long
export const MAX_RESET_MS = 8 * 86_400_000; // no parsed reset time is trusted further out than this (weekly limits fit)
export const DEFAULT_SETTINGS: MeterSettings = { calls5h: 150, tokens5h: 0, warnPct: 80, morningAt: DEFAULT_MORNING, freshLeadMin: DEFAULT_FRESH_LEAD_MIN };
export const emptyMeter = (): Meter => ({ calls: [], settings: { ...DEFAULT_SETTINGS }, limit: null });

/** Adds a call and drops ones older than 7 days (and past MAX_CALLS). */
export function addCall(m: Meter, c: Call, now: number) {
  m.calls.push(c);
  m.calls = m.calls.filter((x) => now - x.at < D7).slice(-MAX_CALLS);
}

export type Win = { calls: number; tokens: number; cost: number; byPurpose: Record<string, { calls: number; tokens: number }> };

/** Calls within the last `span` ms. Purposes are grouped by their first part ("agent.atlas" → "agent"). */
export function windowStats(calls: Call[], now: number, span: number): Win {
  const w: Win = { calls: 0, tokens: 0, cost: 0, byPurpose: {} };
  for (const c of calls) {
    if (now - c.at >= span || c.at > now) continue;
    const t = c.inTok + c.outTok, k = c.purpose.split(".")[0] || "other";
    w.calls++; w.tokens += t; w.cost += c.cost ?? 0;
    const p = (w.byPurpose[k] ??= { calls: 0, tokens: 0 });
    p.calls++; p.tokens += t;
  }
  return w;
}

/** Share of the 5-hour budget used (the larger of calls and tokens), and whether it's past the warning threshold. */
export function usageLevel(m: Meter, now: number) {
  const w = windowStats(m.calls, now, H5), s = m.settings;
  const pct = Math.max(w.calls / s.calls5h, s.tokens5h > 0 ? w.tokens / s.tokens5h : 0) * 100;
  return { pct: Math.round(pct), heavy: pct >= s.warnPct };
}

export const PROBE_MS = 15 * 60_000;
/** A login outage, updated by one call's outcome: the first auth failure opens it (push once), a later one only moves `probed`,
 *  any successful call closes it. Returns what changed so the caller can log/push exactly once. */
export function noteLogin(m: Meter, ok: boolean, errText: string, now: number): "down" | "still" | "back" | null {
  if (ok) { if (!m.login) return null; m.login = null; return "back"; }
  if (!loginFailed(errText)) return null;
  if (m.login) { m.login.probed = now; return "still"; }
  m.login = { at: now, probed: now, text: errText.slice(0, 300) };
  return "down";
}
/** While the login is down: true once every PROBE_MS, so one tiny call checks whether he signed in again. */
export const probeDue = (m: Meter, now: number) => !!m.login && now - m.login.probed >= PROBE_MS;

/** "15:00", or "Mon 15:00" when it's more than 20 h away. */
const when = (t: number, now: number) => new Date(t).toLocaleString([], { ...(t - now > 20 * 3_600_000 ? { weekday: "short" as const } : {}), hour: "2-digit", minute: "2-digit" });

/** Only the real provider limit: what owner clicks (foreground) check. The soft budget never blocks the owner. */
export const hardHoldReason = (m: Meter, now: number): string => (m.limit && m.limit.until > now ? `Claude usage limit reached until ${when(m.limit.until, now)}` : "");

/** The pacer's verdict (presence reservation / pre-morning fresh window), or null. Only with a ctx: callers without one (tests, pure
 *  views) get the plain budget rules and no clock dependence. */
export function paceFor(m: Meter, now: number, ctx?: PaceCtx): Pace | null {
  if (!ctx) return null;
  return paceHold({ now, pct: usageLevel(m, now).pct, sig: ctx.sig, morningAt: m.settings.morningAt, freshLeadMin: m.settings.freshLeadMin });
}

/** Why background lanes should wait right now (provider limit, the owner's soft budget, or the pacer), or "" when they may run. */
export function holdReason(m: Meter, now: number, ctx?: PaceCtx): string {
  const hard = hardHoldReason(m, now);
  if (hard) return hard;
  if (m.login) return "Claude login expired on the ORBIT PC: run `claude`, then /login";
  const l = usageLevel(m, now);
  if (l.heavy) return `Heavy use: ${l.pct}% of your 5-hour budget (${m.settings.calls5h} calls${m.settings.tokens5h ? ` / ${m.settings.tokens5h.toLocaleString()} tokens` : ""})`;
  return paceFor(m, now, ctx)?.reason ?? "";
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** A failed CLI call's text → when its usage/rate limit resets (ms), or null when it isn't a limit error.
 *  Knows "Claude AI usage limit reached|<epoch>", "… limit reached ∙ resets 3pm", "resets Mon 9am", "reset at 15:30",
 *  and API 429 / rate_limit_error (no time given → now + LIMIT_PAUSE_MS). Reset times are this PC's local time. */
export function parseLimitError(text: string, now: number): number | null {
  const until = parseReset(String(text ?? ""), now);
  return until === null ? null : Math.min(Math.max(until, now + 60_000), now + MAX_RESET_MS); // a past or absurd time still pauses briefly / at most 8 days
}

/** A "successful" answer that is really the CLI's limit notice (it sometimes comes back as the result text, not an error). */
export const isLimitAnswer = (text: string) => text.length < 300 && /^\s*Claude AI usage limit reached|hit your limit/i.test(text);

function parseReset(t: string, now: number): number | null {
  const epoch = /limit reached\|(\d{10,13})/i.exec(t);
  if (epoch) { const n = Number(epoch[1]); return n < 1e12 ? n * 1000 : n; }
  if (!/usage limit reached|limit reached|hit your limit|limit will reset|rate_limit_error|API Error: 429|rate limit (?:reached|exceeded)/i.test(t)) return null;
  const m = /resets?(?:\s+at)?\s+(?:(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(t);
  if (!m) return now + LIMIT_PAUSE_MS;
  let h = Number(m[2]);
  const min = Number(m[3] ?? 0), ap = m[4]?.toLowerCase();
  if (ap) h = (h % 12) + (ap === "pm" ? 12 : 0);
  if (h > 23 || min > 59) return now + LIMIT_PAUSE_MS;
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  if (m[1]) d.setDate(d.getDate() + ((DAYS.indexOf(m[1].toLowerCase()) - d.getDay() + 7) % 7));
  while (d.getTime() <= now) d.setDate(d.getDate() + (m[1] ? 7 : 1));
  return d.getTime();
}

const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null);

/** Owner's settings edit → new settings, or an error message. */
export function patchSettings(b: Record<string, unknown>, cur: MeterSettings): MeterSettings | string {
  const next = { ...cur };
  if (b.calls5h !== undefined) { const v = num(b.calls5h, 5, 10_000); if (v === null) return "calls5h must be 5-10000"; next.calls5h = v; }
  if (b.tokens5h !== undefined) { const v = num(b.tokens5h, 0, 1e9); if (v === null) return "tokens5h must be 0 (off) to 1,000,000,000"; next.tokens5h = v; }
  if (b.warnPct !== undefined) { const v = num(b.warnPct, 10, 100); if (v === null) return "warnPct must be 10-100"; next.warnPct = v; }
  if (b.freshLeadMin !== undefined) { const v = num(b.freshLeadMin, 0, MAX_FRESH_LEAD_MIN); if (v === null) return `freshLeadMin must be 0 (off) to ${MAX_FRESH_LEAD_MIN} minutes`; next.freshLeadMin = v; }
  if (b.morningAt !== undefined) { if (typeof b.morningAt !== "string" || Number.isNaN(hmToMin(b.morningAt))) return "morningAt must be HH:MM (24-hour)"; next.morningAt = b.morningAt; }
  return next;
}

/** usage-meter.json text → meter; bad entries are dropped, anything unreadable starts empty (it's only a meter). */
export function parseMeter(raw: string | null): Meter {
  const m = emptyMeter();
  let o: { calls?: unknown; settings?: unknown; limit?: unknown; login?: unknown };
  try { o = JSON.parse(raw ?? ""); } catch { return m; }
  if (!o || typeof o !== "object") return m;
  if (Array.isArray(o.calls)) m.calls = o.calls.filter((c): c is Call => !!c && typeof c.at === "number" && typeof c.purpose === "string"
    && typeof c.inTok === "number" && typeof c.outTok === "number").slice(-MAX_CALLS);
  const s = o.settings && typeof o.settings === "object" ? patchSettings(o.settings as Record<string, unknown>, m.settings) : null;
  if (s && typeof s !== "string") m.settings = s;
  const l = o.limit as Limit | null;
  if (l && typeof l.until === "number" && typeof l.at === "number") m.limit = { until: l.until, at: l.at, text: String(l.text ?? "").slice(0, 300) };
  const g = o.login as Login | null;
  if (g && typeof g.at === "number") m.login = { at: g.at, probed: typeof g.probed === "number" ? g.probed : g.at, text: String(g.text ?? "").slice(0, 300) };
  return m;
}
