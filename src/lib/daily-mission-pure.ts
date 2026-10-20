// Today's mission: three small targets ticked off from real records (clips scheduled/live today, businesses moved to
// "contacted" or later today, approvals waiting), never from what an AI says it did. Built in morning.ts.
export type MissionIn = { shortsToday: number; contactedToday: number; approvalsWaiting: number };
export type MissionItem = { id: "shorts" | "contact" | "approvals"; label: string; done: boolean; progress: string };
export type Mission = { items: MissionItem[]; done: number; total: number };

export const SHORTS_TARGET = 2, CONTACT_TARGET = 1;
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

export function dailyMission(x: MissionIn): Mission {
  const items: MissionItem[] = [
    { id: "shorts", label: `Post ${n(SHORTS_TARGET, "Short")}`, done: x.shortsToday >= SHORTS_TARGET, progress: `${Math.min(x.shortsToday, SHORTS_TARGET)}/${SHORTS_TARGET}` },
    { id: "contact", label: `Contact ${n(CONTACT_TARGET, "business", "businesses")}`, done: x.contactedToday >= CONTACT_TARGET, progress: `${Math.min(x.contactedToday, CONTACT_TARGET)}/${CONTACT_TARGET}` },
    { id: "approvals", label: "Clear your approvals", done: x.approvalsWaiting === 0, progress: x.approvalsWaiting ? `${x.approvalsWaiting} waiting` : "none waiting" },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length };
}

/** One spoken sentence for the briefing. */
export function missionLine(m: Mission): string {
  if (m.done === m.total) return "Today's mission is complete.";
  const left = m.items.filter((i) => !i.done).map((i) => i.label.toLowerCase());
  return `Today's mission: ${left.join(", ")}.`;
}
