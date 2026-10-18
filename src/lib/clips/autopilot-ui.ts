// Pure display helpers for the 🤖 Autopilot tab (src/components/AutopilotPanel.tsx). No imports, so the client can use them.
// Tested in tests/autopilot-ui.test.ts.

export type Pref = { n: number; mult: number };
export type Bar = { label: string; n: number; mult: number; width: number; badge: string };

/** How much to trust one bucket of the learned multipliers. */
export const badge = (n: number) => (n < 2 ? "guess" : n < 5 ? "weak" : n < 15 ? "moderate" : "solid");

const LENGTHS = ["<20", "20-30", "30-40", "40+"];

/** Learned multipliers → bars (width % of the largest, at least 1.5× so small effects look small). Creators: strongest first;
 *  lengths in band order; hours by time. `one`: where 1× (= the channel's usual) sits, in %. */
export function multBars(dim: "creator" | "length" | "hour", rec: Record<string, Pref> | undefined, max = 6): { bars: Bar[]; one: number } {
  const xs = Object.entries(rec ?? {}).filter(([, p]) => p && Number.isFinite(p.mult) && p.mult > 0 && p.n > 0);
  if (dim === "creator") xs.sort((a, b) => Math.abs(Math.log(b[1].mult)) - Math.abs(Math.log(a[1].mult)) || b[1].n - a[1].n);
  else if (dim === "length") xs.sort((a, b) => LENGTHS.indexOf(a[0]) - LENGTHS.indexOf(b[0]));
  else xs.sort((a, b) => a[0].localeCompare(b[0]));
  const shown = xs.slice(0, max), top = Math.max(1.5, ...shown.map(([, p]) => p.mult));
  const pct = (m: number) => Math.round((m / top) * 1000) / 10;
  return { bars: shown.map(([label, p]) => ({ label, n: p.n, mult: p.mult, width: pct(p.mult), badge: badge(p.n) })), one: pct(1) };
}

/** When the daily scout runs next (runAt: local hour; lastScheduled: local day it last ran). */
export function nextScout(runAt: number, lastScheduled: string | undefined, now: Date): Date {
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const t = new Date(now); t.setHours(runAt, 0, 0, 0);
  if (lastScheduled === day(now)) t.setDate(t.getDate() + 1);
  else if (t < now) return now; // due: runs on the next 5-min tick
  return t;
}

export type NextIn = { waiting: number; clipping: number; packaging: number; candidates: number; running: boolean; configured: boolean; creators: number;
  auto: boolean; left: number; runAt: number; lastScheduled?: string };

/** The one line under the hero: what the autopilot does next, or what the owner should do. */
export function nextAction(x: NextIn, now: Date, fmt: (d: Date) => string): string {
  const s = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (x.waiting) return `${s(x.waiting, "clip")} waiting for you`;
  if (x.running) return "Finding candidates now…";
  if (x.clipping) return `Clipping ${s(x.clipping, "video")}…`;
  if (x.packaging) return `Packaging ${s(x.packaging, "clip")} (title, thumbnail, slot)…`;
  if (!x.configured) return "Add YOUTUBE_API_KEY to .env.local to start";
  if (!x.creators) return "Add creators in 🔭 Find videos to start";
  if (x.candidates && x.left) return `${s(x.candidates, "candidate")} ready: clip the best one`;
  const at = nextScout(x.runAt, x.lastScheduled, now);
  return `Finding candidates ${at <= now ? "in a few minutes" : `at ${fmt(at)}`}${x.auto ? (x.left ? ", then clipping the best" : " (today's cap is reached)") : ""}`;
}

/** Creator avatar stand-in: up to 2 initials and a stable hue. */
export function avatar(name: string): { text: string; hue: number } {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const text = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return { text, hue: h };
}
