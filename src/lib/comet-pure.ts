// Deadline comets (N10), pure, tested in tests/comet.test.ts. IO: /api/comets; UI: components/alien/Comets.tsx.
// Each upcoming deadline is a comet whose distance from the CORE is its days left, so it falls in as the day nears.
// Titles only from sources already shown elsewhere: commitments through world-pure's allowlist (no LIFE/journal kinds),
// invoices by number only (no buyer), decisions by their MEMORY title. Anything else fails closed.
import { isDay, worldCommitments } from "./world-pure.ts";
import { PLANETS, type PanelId } from "./planets.ts";

export type CometKind = "commitment" | "invoice" | "decision";
export type CometItem = { id: string; kind: CometKind; title: string; due: string; panel: PanelId };

const DAY = 86_400_000;
export const MAX_COMETS = 20;
export const MAX_OVERDUE = 10;
export const HORIZON_DAYS = 45; // further out than this is not a deadline you can see coming
export const CORE_CLEAR = 3; // radius at 0 days left: just outside the CORE's outer ring (2.29)
export const ORBIT_GAP = 0.4; // keep this far off every planet's orbit path
export const URGENT_MS = 48 * 3600_000;

const TALLINN = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Tallinn", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
/** Tallinn's UTC offset (ms) at instant t. */
const tallinnOffset = (t: number) => {
  const p = Object.fromEntries(TALLINN.formatToParts(t).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
};
/** End of the due day on the owner's Tallinn clock (the next Tallinn midnight, minus 1 ms). */
export const dueAt = (day: string) => {
  const midnight = Date.parse(`${day}T00:00:00Z`) + DAY; // next day 00:00 as if UTC
  return midnight - tallinnOffset(midnight - tallinnOffset(midnight)) - 1;
};
export const daysLeft = (day: string, now: number) => Math.max(0, (dueAt(day) - now) / DAY);

/** Days left → orbit radius: 1 unit per day from CORE_CLEAR, pushed out of any planet's orbit lane. */
export function cometRadius(days: number, orbits: readonly number[] = PLANETS.map((p) => p.radius)): number {
  let r = CORE_CLEAR + Math.max(0, Math.min(HORIZON_DAYS, Number.isFinite(days) ? days : HORIZON_DAYS));
  for (const o of [...orbits].sort((a, b) => a - b)) if (Math.abs(r - o) < ORBIT_GAP) r = o + ORBIT_GAP; // sorted: a push can't land in a lane already passed
  return r;
}

/** A fixed angle per item (FNV-1a of its id) so a comet keeps its bearing day to day. */
export function cometAngle(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

export function cometPosition(it: Pick<CometItem, "id" | "due">, now: number): [number, number, number] {
  const r = cometRadius(daysLeft(it.due, now)), a = cometAngle(it.id);
  return [Math.cos(a) * r, 0.6 + (cometAngle(`${it.id}y`) - Math.PI) * 0.12, Math.sin(a) * r]; // a little above the plane
}

export const isUrgent = (due: string, now: number) => dueAt(due) - now < URGENT_MS;

type RawCommit = Parameters<typeof worldCommitments>[0][number];
type RawInvoice = { id: string; number: string; status: string; due: string };
type RawDecision = { id: string; kind?: string | null; title: string; tags?: string[] | null };

/** The comets to draw: within the horizon (overdue ones stay, red, at the CORE), soonest first, at most MAX_COMETS. */
export function cometItems(src: { commitments?: RawCommit[]; invoices?: RawInvoice[]; decisions?: RawDecision[] }, now: number): CometItem[] {
  const out: CometItem[] = [];
  // One row at a time through worldCommitments: same allowlist, but the dated filter runs before its 50 cap and the id survives.
  for (const raw of src.commitments ?? []) {
    if (!raw.due || !isDay(raw.due)) continue;
    const [c] = worldCommitments([raw]);
    if (c?.due) out.push({ id: `c:${(raw as { id?: string }).id ?? c.text}`, kind: "commitment", title: c.text, due: c.due, panel: "life" });
  }
  for (const v of src.invoices ?? []) if (v.status === "sent" && isDay(v.due)) out.push({ id: `i:${v.id}`, kind: "invoice", title: `Invoice ${String(v.number).slice(0, 40)}`, due: v.due, panel: "business" });
  for (const d of src.decisions ?? []) {
    const tags = d.tags ?? [];
    if (d.kind !== "decision" || tags.some((t) => t === "revisited" || t === "superseded" || t === "revoked")) continue;
    const day = tags.find((t) => /^revisit:\d{4}-\d{2}-\d{2}$/.test(t))?.slice(8);
    if (day && isDay(day)) out.push({ id: `d:${d.id}`, kind: "decision", title: `Revisit: ${d.title.replace(/^Decision:\s*/, "").slice(0, 200)}`, due: day, panel: "memory" });
  }
  const sorted = out.filter((c) => daysLeft(c.due, now) <= HORIZON_DAYS).sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
  const late = sorted.filter((c) => dueAt(c.due) < now); // overdue sort first; keep the newest MAX_OVERDUE so upcoming ones still fit
  return [...late.slice(-MAX_OVERDUE), ...sorted.slice(late.length)].slice(0, MAX_COMETS);
}
