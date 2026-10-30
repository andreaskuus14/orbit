// LIFE Today (LIF01/LIF02) on top of the existing day planner (dayplan-pure.ts builds the plan: fixed blocks never move, flexible
// work capped and buffered). Here: the one next action, why something isn't scheduled, and the smallest fix when a block overruns.
import type { Block, DayPlan } from "./dayplan-pure.ts";

const work = (b: Block) => b.flexible && !b.done;

/** One realistic next action at minute `now`: the flexible block running now, else the next one that starts later today. */
export function nextAction(p: DayPlan | null, now: number): { block: Block; now: boolean; freeMin: number } | null {
  if (!p) return null;
  const cur = p.blocks.find((b) => work(b) && b.start <= now && b.end > now);
  const b = cur ?? p.blocks.find((x) => work(x) && x.start > now);
  if (!b) return null;
  const nextFixed = p.blocks.find((x) => !x.flexible && x.start >= b.end);
  return { block: b, now: !!cur, freeMin: (nextFixed?.start ?? 24 * 60) - b.end };
}

/** i18n key explaining why an item is unscheduled: over today's realistic cap, no free slot left, or it has no estimate/time. */
export const whyKey = (u: DayPlan["unplaced"][number]) => (u.why === "cap" ? "life.why.cap" : u.why === "time" ? "life.why.time" : "life.why.manual");

export type Adjustment = { plan: DayPlan; moved: string[]; dropped: string[] };

/** The block `id` runs `extra` minutes longer (or he changed it): push only the flexible blocks after it as little as needed,
 *  keeping the buffer; locked blocks (calendar, protected time, study) never move. A block that no longer fits before dayEnd
 *  is unscheduled (why "time") rather than squeezed. Returns a string to refuse. */
export function adjustPlan(p: DayPlan, id: string, extra: number, buffer = 10, dayEnd = 22 * 60): Adjustment | string {
  const at = p.blocks.findIndex((b) => b.id === id);
  if (at < 0) return "No such block";
  if (!p.blocks[at].flexible) return "Fixed blocks don't move";
  if (!Number.isInteger(extra) || extra < 5 || extra > 240) return "Extra minutes must be 5–240";
  const movable = (b: Block) => b.flexible || b.source.kind === "break"; // a planned break moves with the work around it
  const fixed = p.blocks.filter((b) => !movable(b));
  const clash = (s: number, e: number) => fixed.find((f) => s < f.end && e > f.start);
  const blocks = p.blocks.map((b) => ({ ...b }));
  const over = blocks[at];
  over.end += extra;
  const hit = clash(over.start, over.end);
  if (hit) over.end = Math.max(over.start + 5, hit.start); // overrunning into a locked event: the locked event wins
  let free = over.end + buffer;
  const moved: string[] = [], dropped: string[] = [];
  const later = blocks.filter((b) => movable(b) && b.start > p.blocks[at].start && b.id !== id).sort((a, b) => a.start - b.start);
  for (const b of later) {
    if (b.start >= free) { free = b.end + buffer; continue; } // already clear: everything after stays put
    const len = b.end - b.start;
    let s = free;
    for (let f = clash(s, s + len); f; f = clash(s, s + len)) s = f.end;
    if (s + len > dayEnd) { dropped.push(b.id); continue; }
    b.start = s; b.end = s + len; moved.push(b.id);
    free = b.end + buffer;
  }
  const out = blocks.filter((b) => !dropped.includes(b.id)).sort((a, b) => a.start - b.start);
  const un = p.blocks.filter((b) => dropped.includes(b.id) && b.flexible).map((b) => ({ id: b.id, title: b.title, source: b.source, why: "time" as const }));
  return { plan: { ...p, blocks: out, unplaced: [...p.unplaced, ...un] }, moved, dropped };
}
