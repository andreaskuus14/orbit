// Living galaxy status (owner: "I have a problem → ORBIT fixes it → I see the progress"): the home galaxy as a one-glance view.
// Each world gets ONE calm state from the data ORBIT already has: the shared progress cards (progress-pure: agent tasks, clip
// jobs, autopilot projects), the Needs-you inbox (needs-you-pure) and the doctor's boot self-test (doctor-pure checks).
//   idle → dim · working → slow gentle pulse + a small count · needs → a small amber dot by its name · broke → a small rose dot.
// No rings: a red ring round a world read as an alarm (owner, 22 Nov: "there is a red circle in the orbit, I want that gone").
// A failed run stops counting once a later run of the same work finished, or after PROBLEM_MAX_AGE_MS (OPERATIONS keeps it).
// Hover / tap gives one plain sentence ("STUDIO: making the Shorts, about 6 min left"). Pure; tests in tests/galaxy-status.test.ts.
// LIFE shows counts only: no journal / LIFE text ever reaches the galaxy.
import type { Lang } from "./i18n-pure.ts";
import type { PlanetId } from "./planets.ts";
import type { Progress } from "./progress-pure.ts";
import { shipTarget } from "./ships-pure.ts";
import { PROBLEM_MAX_AGE_MS } from "./run-recovery-pure.ts";

export type GalaxyState = "idle" | "working" | "needs" | "broke";
export type WorldStatus = { state: GalaxyState; working: number; needs: number; broke: number; leftMin: number | null; line: string };
export type StatusWorld = PlanetId | "core";
export type GalaxyStatus = Partial<Record<StatusWorld, WorldStatus>>;

/** A Needs-you item, as /api/needs-you returns it (only the fields we read). */
export type NeedLike = { ref: string; kind: "decide" | "unblock" | "review"; cause: string; title: string };
/** A doctor check (doctor-pure Check). */
export type CheckLike = { id: string; status: "ok" | "warn" | "fail"; label?: string; detail?: string };
/** A progress card, with the world it belongs to when the source knows it (else it is placed by its id / title). */
export type PlacedProgress = Progress & { planet?: PlanetId; agent?: string; request?: string | null };

const KW = (s: string) => shipTarget({ title: s, agent: "", request: "" }); // "agents" when no keyword matches

/** The world a progress card belongs to. Clip jobs and downloads → STUDIO, plans → OPERATIONS, the briefing → INTELLIGENCE,
 *  autopilot projects and agent tasks → what their words concern (ships-pure), else AGENTS. */
export function progressWorld(p: PlacedProgress): PlanetId {
  if (p.planet) return p.planet;
  const id = String(p.id ?? "");
  if (/^(clip|dl):/.test(id)) return "studio";
  if (/^plan:/.test(id)) return "operations";
  if (id === "brief") return "intelligence";
  return shipTarget({ title: p.title ?? "", agent: p.agent ?? "", request: p.request ?? null });
}

const REF_WORLD: [RegExp, StatusWorld][] = [
  [/^(invoice|prospect|client|contract|delivery|lead|negotiation|business):/, "business"],
  [/^(clip|short|video|upload|studio):/, "studio"],
  [/^(watch|news):/, "intelligence"],
  [/^(memory|revisit|fact|conflict):/, "memory"],
  [/^(habit|life|journal):/, "life"],
  [/^(vault|file):/, "vault"],
  [/^(health|system|migration|durable)/, "core"],
];
/** The world a Needs-you item belongs to: by its record ref, then by what its title is about. System items → CORE. */
export function needWorld(n: NeedLike): StatusWorld {
  if (n.cause === "system") return "core";
  const ref = String(n.ref ?? "").replace(/^group:/, "");
  for (const [re, w] of REF_WORLD) if (re.test(ref)) return w;
  if (n.cause === "overdue" || n.cause === "followup" || n.cause === "delivery") return "business";
  if (n.cause === "watch") return "intelligence";
  if (n.cause === "revisit" || n.cause === "conflict") return "memory";
  return KW(n.title ?? "");
}

const CHECK_WORLD: Record<string, StatusWorld> = {
  ytkey: "studio", oauth: "studio", clipwarn: "studio", ffmpeg: "studio", ytdlp: "studio", whisper: "studio", hyperframes: "studio", tools: "studio",
  life: "life", journal: "life", vault: "vault", ocr: "vault", facts: "memory", night: "operations", wake: "operations",
};
/** The world a failing doctor check belongs to; anything about ORBIT itself (login, database, disk, build…) → CORE. */
export const checkWorld = (c: Pick<CheckLike, "id">): StatusWorld => CHECK_WORLD[c.id] ?? "core";

const W = {
  en: {
    quiet: "all quiet", things: (n: number) => `working on ${n} things`, needs: (n: number) => (n === 1 ? "1 thing needs you" : `${n} things need you`),
    broke: "something broke", brokeN: (n: number) => `${n} things broke`, alsoWorking: (n: number) => `still working on ${n}`, fix: "open the doctor to fix it",
  },
  et: {
    quiet: "kõik on vaikne", things: (n: number) => `töös ${n} asja`, needs: (n: number) => (n === 1 ? "1 asi vajab sind" : `${n} asja vajab sind`),
    broke: "midagi läks katki", brokeN: (n: number) => `${n} asja läks katki`, alsoWorking: (n: number) => `töös veel ${n}`, fix: "ava arst, et parandada",
  },
} as const;
const LEFT = {
  en: (m: number) => (m <= 1 ? "almost done" : m < 120 ? `about ${m} min left` : `about ${Math.round(m / 60)} h left`),
  et: (m: number) => (m <= 1 ? "kohe valmis" : m < 120 ? `umbes ${m} min veel` : `umbes ${Math.round(m / 60)} h veel`),
};
const lowerFirst = (s: string) => (s ? s[0].toLocaleLowerCase() + s.slice(1) : s);
const clip = (s: string, max = 70) => { const t = String(s ?? "").replace(/\s+/g, " ").trim().replace(/[.!]+$/, ""); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

type Acc = { working: Progress[]; needs: string[]; broke: string[]; brokeSystem: boolean };

/** Does a failed progress card still count as a problem? Not when it is older than PROBLEM_MAX_AGE_MS, and not when a later
 *  card of the same work (same title: an automation's runs are all "⚙ Name") finished done. Unknown time: it counts. */
export function failedStillCounts(p: Pick<Progress, "id" | "title" | "at">, all: readonly Pick<Progress, "id" | "title" | "at" | "phase">[], now: number): boolean {
  const at = Date.parse(p.at ?? "");
  if (Number.isFinite(at) && Number.isFinite(now) && now - at > PROBLEM_MAX_AGE_MS) return false;
  return !all.some((q) => q.id !== p.id && q.phase === "done" && q.title === p.title && Number.isFinite(at) && Date.parse(q.at ?? "") > at);
}

/** Everything → one state + one sentence per world. names: the world names to lead the sentence with ("STUDIO"). Only worlds
 *  in `names` are returned (every one of them: idle when nothing is known about it). Priority: broke > needs > working > idle. */
export function galaxyStatus(x: { progress?: PlacedProgress[] | null; needs?: NeedLike[] | null; checks?: CheckLike[] | null; now?: number }, names: Partial<Record<StatusWorld, string>>, lang: Lang): GalaxyStatus {
  const acc = new Map<StatusWorld, Acc>();
  const get = (w: StatusWorld) => { let a = acc.get(w); if (!a) acc.set(w, (a = { working: [], needs: [], broke: [], brokeSystem: false })); return a; };
  const seen = new Set<string>(); // one piece of work counts once: a task that waits for him is both a card and a Needs-you item
  const cards = (x.progress ?? []).filter((p): p is PlacedProgress => !!p && typeof p === "object"), now = x.now ?? Date.now();
  for (const p of cards) {
    const w = progressWorld(p);
    if (p.phase === "working" || p.phase === "waiting") get(w).working.push(p);
    else if (p.phase === "needs") { if (!seen.has(`task:${p.id}`)) { seen.add(`task:${p.id}`); get(w).needs.push(p.title); } }
    else if (p.phase === "failed") { if (!seen.has(`task:${p.id}`)) { seen.add(`task:${p.id}`); if (failedStillCounts(p, cards, now)) get(w).broke.push(p.result?.text || p.title); } }
  }
  for (const n of x.needs ?? []) {
    if (!n || n.kind === "review") continue; // a finished result to look at is not a problem: it stays calm
    const key = n.ref.replace(/^group:/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const w = needWorld(n);
    if (n.kind === "unblock" && n.cause === "failed") get(w).broke.push(n.title);
    else if (n.kind === "unblock" && n.cause === "system") { get(w).broke.push(n.title); get(w).brokeSystem = true; }
    else get(w).needs.push(n.title);
  }
  for (const c of x.checks ?? []) {
    if (!c || c.status !== "fail") continue;
    const a = get(checkWorld(c));
    a.broke.push(c.label || c.detail || ""); a.brokeSystem = true;
  }
  const out: GalaxyStatus = {};
  const s = W[lang];
  for (const [w, name] of Object.entries(names) as [StatusWorld, string][]) {
    const a = acc.get(w) ?? { working: [], needs: [], broke: [], brokeSystem: false };
    const counts = a.working.length, lefts = a.working.map((p) => p.leftMin).filter((m): m is number => typeof m === "number" && Number.isFinite(m) && m > 0);
    const leftMin = lefts.length ? Math.max(...lefts) : null;
    const state: GalaxyState = a.broke.length ? "broke" : a.needs.length ? "needs" : counts ? "working" : "idle";
    const priv = w === "life"; // LIFE: counts only, never its text
    let line: string;
    if (state === "broke") {
      const what = a.broke.length === 1 && !priv && clip(a.broke[0]) ? `${s.broke}: ${lowerFirst(clip(a.broke[0]))}` : a.broke.length === 1 ? s.broke : s.brokeN(a.broke.length);
      line = [what, a.brokeSystem && s.fix, counts && s.alsoWorking(counts)].filter(Boolean).join(", ");
    } else if (state === "needs") {
      const what = a.needs.length === 1 && !priv && clip(a.needs[0]) ? `${s.needs(1)}: ${clip(a.needs[0])}` : s.needs(a.needs.length);
      line = [what, counts && s.alsoWorking(counts)].filter(Boolean).join(", ");
    } else if (state === "working") {
      const one = a.working[0];
      const what = counts === 1 && !priv ? lowerFirst(clip(one.now || one.title)) : s.things(counts);
      line = [what || s.things(counts), leftMin !== null && LEFT[lang](leftMin)].filter(Boolean).join(", ");
    } else line = s.quiet;
    out[w] = { state, working: counts, needs: a.needs.length, broke: a.broke.length, leftMin, line: `${name}: ${line}` };
  }
  return out;
}

// ---- how a state looks (pure numbers; the scene reads them every frame) ----
export const AMBER = "#f5b25c", ROSE = "#eeaab6"; // soft, not alarm: a small dot by the name, never a ring or a flashing light
/** Seconds per breath of the working pulse: slow, calm. */
export const PULSE_PERIOD = 4.2;
/** mark: the small dot beside the world's name (needs → amber, broke → rose); there is no ring. */
export type StatusLook = { dim: number; glow: number; mark: "amber" | "rose" | null; count: number };
/** The look of a state at scene time t (seconds). Reduced motion: no pulse, a steady soft glow instead. undefined → neutral. */
export function statusLook(st: WorldStatus | undefined, t: number, reduced: boolean): StatusLook {
  if (!st) return { dim: 0, glow: 0, mark: null, count: 0 };
  const breath = reduced || !Number.isFinite(t) ? 0.5 : 0.5 - 0.5 * Math.cos((t * 2 * Math.PI) / PULSE_PERIOD); // 0..1, starts at rest
  switch (st.state) {
    case "idle": return { dim: 0.3, glow: 0, mark: null, count: 0 };
    case "working": return { dim: 0, glow: 0.12 + 0.18 * breath, mark: null, count: st.working };
    case "needs": return { dim: 0, glow: st.working ? 0.12 : 0, mark: "amber", count: st.working };
    case "broke": return { dim: 0, glow: 0, mark: "rose", count: st.working };
  }
}

/** The marker dot beside a name: needs → amber, broke (or an outside "it failed" flag) → rose, else none. */
export const markTone = (st: WorldStatus | undefined, failing = false): "amber" | "rose" | null =>
  st?.state === "broke" || failing ? "rose" : st?.state === "needs" ? "amber" : null;

/** The small count beside a world's name: only while it works on something; "9+" past nine. */
export const countBadge = (st: WorldStatus | undefined) => (!st || !st.working ? "" : st.working > 9 ? "9+" : String(st.working));
/** The sentence without its leading "NAME: " (the hover card already shows the name above it), first letter capitalised. */
export function sentenceRest(line: string): string {
  const i = line.indexOf(": ");
  const r = i >= 0 ? line.slice(i + 2) : line;
  return r ? r[0].toLocaleUpperCase() + r.slice(1) : r;
}
