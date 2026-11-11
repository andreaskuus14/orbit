// Number tick: where a counter should be `ms` into a tick from `from` to `to` lasting `dur` ms (ease-out cubic, whole numbers).
export function tickAt(from: number, to: number, ms: number, dur: number): number {
  if (dur <= 0 || ms >= dur || from === to) return to;
  const k = 1 - (1 - Math.max(0, ms) / dur) ** 3;
  return Math.round(from + (to - from) * k);
}
