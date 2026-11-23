// While a LIFE screen (LIFE panel, Today in a minute) is open in ORBIT, desk screenshots are refused (api/voice/desk).
// In memory on the server; the client pings it (life-private-pure SHIELD_PING_MS) and it lapses by itself.
import { shieldActive, shieldUntil } from "./life-private-pure";

const g = globalThis as unknown as { __orbitLifeShield?: Map<string, number> };
const holders = () => (g.__orbitLifeShield ??= new Map());

/** on: renew; off: clear. One shared flag: any open LIFE screen keeps it on until its own ping lapses. */
export function setLifeShield(on: boolean, now: number, who = "ui") {
  if (on) holders().set(who, shieldUntil(now)); else holders().delete(who);
}
export function lifeShieldUntil(now: number): number | null {
  let max: number | null = null;
  for (const [k, u] of holders()) { if (!shieldActive(u, now)) holders().delete(k); else if (max === null || u > max) max = u; }
  return max;
}
