// Is the internet up? IO for net-wait-pure.ts: one DNS lookup of the database host (or Claude's API host), cached 10 s, with a
// 3 s limit. Used by the scheduler (no scheduled job starts while offline), STUDIO downloads and the boot self-test. Nothing is sent:
// a DNS lookup of a host ORBIT already talks to.
import { lookup } from "node:dns/promises";
import { netEdge, probeHosts } from "./net-wait-pure";

const CACHE_MS = 10_000;
const G = globalThis as unknown as { __orbitNet?: { at: number; ok: boolean; last: boolean | null; since: number } };
const st = (G.__orbitNet ??= { at: 0, ok: true, last: null, since: Date.now() });

async function probe(): Promise<boolean> {
  const hosts = probeHosts(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const one = (h: string) => Promise.race([lookup(h).then(() => true, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), 3_000).unref?.())]);
  return (await Promise.all(hosts.map(one))).some(Boolean);
}

/** True when the internet answers (cached 10 s). Logs one line when it goes away and when it comes back. */
export async function online(): Promise<boolean> {
  if (process.env.ORBIT_NET_WAIT === "0") return true; // switch: behave as before (never wait)
  if (Date.now() - st.at < CACHE_MS) return st.ok;
  const ok = await probe();
  const edge = netEdge(st.last, ok);
  if (edge === "down") console.warn("[orbit] no internet: scheduled jobs wait until it is back");
  if (edge === "up") console.log(`[orbit] internet is back after ${Math.round((Date.now() - st.since) / 1000)} s: waiting jobs run again`);
  if (edge) st.since = Date.now();
  Object.assign(st, { at: Date.now(), ok, last: ok });
  return ok;
}

/** Resolves true once online (checked every stepMs), or false after maxMs. */
export async function whenOnline(maxMs = 6 * 3_600_000, stepMs = 15_000): Promise<boolean> {
  const end = Date.now() + maxMs;
  for (;;) {
    if (await online()) return true;
    if (Date.now() + stepMs > end) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
