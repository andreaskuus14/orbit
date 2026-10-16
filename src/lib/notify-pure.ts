// Notification center bus + history rules. Pure (no React); tested in tests/notify.test.ts. UI: src/components/NotificationCenter.tsx.
import type { NavTarget } from "./nav-pure.ts";
import { ago } from "./watch-pure.ts";

export const NOTIFY_EVENT = "orbit:notify"; // detail: NotifyDetail
export type NotifyKind = "studio" | "agents" | "life" | "core" | "system";
export type NotifyDetail = { title: string; body?: string; kind: NotifyKind; nav?: NavTarget };
export type NotifyItem = NotifyDetail & { id: string; at: number; read: boolean };

export const NOTIFY_KEY = "orbit.notifications";
export const NOTIFY_CAP = 50;
const DEDUPE_MS = 60_000;
const KINDS: NotifyKind[] = ["studio", "agents", "life", "core", "system"];
export const KIND_ICON: Record<NotifyKind, string> = { studio: "🎬", agents: "🤖", life: "⏰", core: "✨", system: "⚙️" };

/** Publish to the bell. No-op where there's no event target (server, tests). */
export function notify(detail: NotifyDetail): void {
  const g = globalThis as { dispatchEvent?: (e: Event) => boolean; CustomEvent?: typeof CustomEvent };
  if (g.dispatchEvent && g.CustomEvent) g.dispatchEvent(new g.CustomEvent(NOTIFY_EVENT, { detail }));
}

/** Newest first, capped; an identical title+body within 60 s of the newest such item is dropped. */
export function addItem(list: NotifyItem[], d: NotifyDetail, now: number, id = `${now}-${Math.random().toString(36).slice(2, 8)}`): NotifyItem[] {
  const title = String(d.title ?? "").slice(0, 200), body = d.body ? String(d.body).slice(0, 500) : undefined;
  if (!title || !KINDS.includes(d.kind)) return list;
  if (list.some((x) => x.title === title && (x.body ?? "") === (body ?? "") && now - x.at < DEDUPE_MS)) return list;
  return [{ id, at: now, read: false, title, body, kind: d.kind, nav: d.nav }, ...list].slice(0, NOTIFY_CAP);
}

/** localStorage text → items; anything malformed is dropped. */
export function parseItems(raw: string | null): NotifyItem[] {
  let v: unknown;
  try { v = JSON.parse(raw ?? "[]"); } catch { return []; }
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is NotifyItem => !!x && typeof x === "object" && typeof x.id === "string" && typeof x.title === "string"
    && typeof x.at === "number" && KINDS.includes(x.kind)).map((x) => ({ ...x, read: x.read === true })).slice(0, NOTIFY_CAP);
}

export const unreadCount = (list: NotifyItem[]) => list.filter((x) => !x.read).length;

/** "just now", "5 minutes ago". */
export const relTime = (at: number, now: number) => (now - at < 60_000 ? "just now" : ago(new Date(at).toISOString(), now));
