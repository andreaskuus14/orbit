// fsociety terminal: API bodies → log lines. Pure (no DOM), tested in tests/terminal.test.ts. UI: components/Terminal.tsx.
export const TERMINAL_EVENT = "orbit:terminal";

/** id: what the line is about; a line prints again only when its body for that id changes. */
export type Line = { id: string; body: string; text: string };

export const BANNER = String.raw`
  ___  ____  ____ ___ _____
 / _ \|  _ \| __ )_ _|_   _|
| | | | |_) |  _ \| |  | |
| |_| |  _ <| |_) | |  | |
 \___/|_| \_\____/___| |_|   // read-only feed`;

const pad = (n: number) => String(n).padStart(2, "0");
/** Local "HH:MM:SS"; "--:--:--" for a bad date. */
export function clock(at: string | number | Date): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "--:--:--" : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** ms → "3d 04:05:06" / "04:05:06". */
export function uptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400);
  return `${d ? `${d}d ` : ""}${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
const cut = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const line = (id: string, at: string | number | Date, body: string): Line => ({ id, body, text: `[${clock(at)}] ${body}` });
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const str = (x: unknown) => (typeof x === "string" ? x : "");

/** /api/activity {items: [{at, area, title, detail?}]} (newest first) → oldest-first lines. */
export function activityLines(body: unknown, max = 30): Line[] {
  const items = Array.isArray(obj(body).items) ? (obj(body).items as unknown[]) : [];
  return items.slice(0, max).map(obj).filter((i) => str(i.title)).reverse().map((i) => {
    const b = cut(`${str(i.area) || "log"} ▶ ${str(i.title)}${str(i.detail) ? ` — ${str(i.detail)}` : ""}`);
    return line(`act:${str(i.at)}:${str(i.title)}`, str(i.at), b);
  });
}

/** /api/usage-meter {h5, d7, level: {pct, heavy}, hold, limit} → lines. */
export function usageLines(body: unknown, now: number): Line[] {
  const u = obj(body); if (!u.h5) return [];
  const h5 = obj(u.h5), lvl = obj(u.level), out = [line("usage", now, `usage ▶ 5h ${num(h5.calls)} calls · ${num(h5.tokens).toLocaleString("en-US")} tok · ${num(lvl.pct)}%${lvl.heavy ? " HEAVY" : ""}`)];
  if (str(u.hold)) out.push(line("usage:hold", now, `usage ✖ ${cut(str(u.hold))}`));
  return out;
}

/** /api/doctor?boot=1 {report: {status, headline, checks}} (or a plain report) → lines; failing/warning checks listed. */
export function doctorLines(body: unknown, now: number): Line[] {
  const r = obj(obj(body).report ?? body); if (!str(r.status)) return [];
  const mark = (s: string) => (s === "ok" ? "✔" : s === "warn" ? "!" : "✖");
  const checks = (Array.isArray(r.checks) ? r.checks : []).map(obj).filter((c) => c.status === "warn" || c.status === "fail");
  return [line("doctor", now, `doctor ${mark(str(r.status))} ${cut(str(r.headline) || str(r.status))}`),
    ...checks.map((c) => line(`doctor:${str(c.id)}`, now, `doctor:${str(c.id)} ${mark(str(c.status))} ${cut(str(c.detail))}`))];
}

/** /api/agents/stats {agents: {slug: {running, awaiting, done, failed}}} → a 30-day total plus one line per busy agent. */
export function agentLines(body: unknown, now: number): Line[] {
  const agents = obj(obj(body).agents), out: Line[] = [];
  let done = 0, failed = 0;
  for (const [slug, v] of Object.entries(agents)) {
    const a = obj(v); done += num(a.done); failed += num(a.failed);
    out.push(line(`agent:${slug}`, now, num(a.running) ? `agent:${slug} ▶ running${num(a.running) > 1 ? ` ×${num(a.running)}` : ""}`
      : num(a.awaiting) ? `agent:${slug} ⏸ awaiting approval` : `agent:${slug} · idle`));
  }
  return [line("agents", now, `agents ▶ 30d ${done} done · ${failed} failed`), ...out];
}

/** /api/studio/busy {busy, clips, downloads, scout, publishing} → one line. */
export function busyLines(body: unknown, now: number): Line[] {
  const b = obj(body);
  if (str(b.error)) return [line("studio", now, `studio ✖ ${str(b.error)}`)];
  if (typeof b.busy !== "boolean") return [];
  const what = ["clips", "downloads", "scout", "publishing"].filter((k) => b[k] === true);
  return [line("studio", now, b.busy ? `studio ▶ busy: ${what.join(", ") || "scout pending"}` : "studio · idle")];
}

/** /api/goals {goals: [{id, title, status, progress: {pct}}]} → a line per open goal. */
export function goalLines(body: unknown, now: number): Line[] {
  const goals = Array.isArray(obj(body).goals) ? (obj(body).goals as unknown[]).map(obj) : [];
  return goals.filter((g) => g.status !== "done" && g.status !== "stopped").map((g) => {
    const pct = obj(g.progress).pct;
    return line(`goal:${str(g.id)}`, now, cut(`goal ▶ ${str(g.title)} [${str(g.status)}]${typeof pct === "number" ? ` ${Math.round(pct)}%` : ""}`));
  });
}

/** One-line status bar. */
export function statsLine(upMs: number, usage: unknown, stats: unknown, doctor: unknown): string {
  const running = Object.values(obj(obj(stats).agents)).reduce((n: number, a) => n + num(obj(a).running), 0);
  const pct = obj(obj(usage).level).pct, health = str(obj(obj(doctor).report ?? doctor).status);
  return `up ${uptime(upMs)} · agents ${running} running · usage ${typeof pct === "number" ? `${pct}%` : "?"} · health ${health || "?"}`;
}

/** Append lines whose body changed for their id (mutates `last`); keeps the newest `max`. */
export function appendNew(log: Line[], last: Map<string, string>, next: Line[], max = 300): Line[] {
  const add = next.filter((l) => last.get(l.id) !== l.body);
  for (const l of add) last.set(l.id, l.body);
  return add.length ? [...log, ...add].slice(-max) : log;
}
