// Second screen (roadmap 3): a read-only ORBIT "mission control" for a tablet or second monitor, paired like the phone remote.
// Pure: the device scope check and the dashboard's data shaping. Server glue: /api/remote/screen; page: /screen.
// Tested in tests/screen.test.ts. Never shaped in: email bodies, recipients, amounts, journal or task results.
import type { FocusTimer } from "./focus-timer-pure.ts";
import { stoppedText } from "./night-pure.ts";

export type DeviceType = "phone" | "screen";
/** A device stored without a type is a phone paired before screens existed: full remote. */
export const deviceType = (d: { type?: unknown }): DeviceType => (d.type === "screen" ? "screen" : "phone");
/** What a screen may do: look. Commands of the phone remote that read nothing private, plus the screen's own view. */
export const SCREEN_ALLOWED = ["status", "screen"] as const;
/** Server-side scope check: a phone may do everything the remote offers; a screen only what is on the read-only allow-list. */
export const scopeAllows = (type: DeviceType, action: string) => type === "phone" || (SCREEN_ALLOWED as readonly string[]).includes(action);

const MONEY = /(?:[€$£]\s?\d[\d.,\s]*\d|[€$£]\s?\d|\b\d[\d.,]*\s?(?:k\b)?\s?(?:€|eur(?:os?)?\b|usd\b|dollars?\b|kr\b|sek\b|credits?\b))/gi;
/** Titles go on a screen others may see: drop money and credit amounts, cap length. */
export const noAmounts = (s: string, max = 90) => {
  const t = String(s ?? "").replace(MONEY, "…").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export type TaskRow = { id: string; parent_id: string | null; agent: string; title: string; status: string; started_at: string | null };
export type ScreenIn = {
  stop: { on: boolean };
  brief: { greeting: string; items: { kind: string; title: string }[] } | null;
  tasks: TaskRow[]; // queued, running and awaiting_approval rows (top-level and chain steps)
  approvals: { kind: string; title: string }[]; // the phone remote's waiting items (titles only are used)
  night: { enabled: boolean; from: string; until: string; running: boolean; queued: number; report: { done: unknown[]; approvals: unknown[]; failed: unknown[]; stopped?: string } | null } | null;
  focus: FocusTimer | null;
};
export type ScreenView = {
  stop: boolean;
  brief: { greeting: string; items: { kind: string; title: string }[] } | null;
  agents: { id: string; agent: string; title: string; status: "running" | "queued"; since: string | null; step?: string }[];
  approvals: { kind: string; title: string }[];
  night: { enabled: boolean; window: string; running: boolean; queued: number; done: number; toApprove: number; failed: number; stopped?: string } | null;
  focus: { phase: "focus" | "break"; endAt: number } | null;
};

const CHAIN = "Team: ";
const MAX_LIST = 8;

/** The dashboard as the screen draws it. Only titles and counts; anything else in the input is dropped here. */
export function screenView(x: ScreenIn, now: number): ScreenView {
  const top = x.tasks.filter((t) => !t.parent_id);
  const kids = (id: string) => x.tasks.filter((t) => t.parent_id === id);
  const agents = top.filter((t) => t.status === "running" || t.status === "queued").map((t) => {
    const live = kids(t.id).find((k) => k.status === "running");
    return {
      id: t.id, agent: t.agent, title: noAmounts(t.title.startsWith(CHAIN) ? t.title.slice(CHAIN.length) : t.title), status: t.status as "running" | "queued",
      since: t.started_at, ...(t.title.startsWith(CHAIN) && live && { step: live.agent }),
    };
  }).sort((a, b) => (a.status === b.status ? 0 : a.status === "running" ? -1 : 1)).slice(0, MAX_LIST);
  const approvals = [
    ...x.approvals.map((a) => ({ kind: a.kind, title: noAmounts(a.title) })),
    ...x.tasks.filter((t) => t.status === "awaiting_approval").map((t) => ({ kind: "task", title: noAmounts(t.title.startsWith(CHAIN) ? t.title.slice(CHAIN.length) : t.title) })),
  ].slice(0, MAX_LIST);
  const n = x.night, r = n?.report;
  const f = x.focus;
  return {
    stop: x.stop.on,
    brief: x.brief && { greeting: x.brief.greeting, items: x.brief.items.slice(0, 6).map((i) => ({ kind: i.kind, title: noAmounts(i.title) })) },
    agents,
    approvals,
    night: n && { enabled: n.enabled, window: `${n.from}–${n.until}`, running: n.running, queued: n.queued,
      done: r?.done.length ?? 0, toApprove: r?.approvals.length ?? 0, failed: r?.failed.length ?? 0, ...(r?.stopped && { stopped: stoppedText(r.stopped) }) },
    focus: f && f.endAt > now ? { phase: f.phase, endAt: f.endAt } : null,
  };
}

/** "12:05" left until endAt (the screen's clock ticks it down between refreshes). */
export const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
