// Galaxy home + CORE (MIX look, 23 Nov): the small pure helpers the home screen reads. Planet names in sentence case for the
// galaxy labels, one short live readout per planet ("2 jobs · 4 min left"), the "9+" badge, the voice meter's bar heights and
// the Needs-you detail + question join. Pure; tests in tests/home-ui.test.ts.
import type { Lang } from "./i18n-pure.ts";
import type { WorldStatus } from "./galaxy-status-pure.ts";

/** "GAME DEV" → "Game dev", "MÄLU" → "Mälu". Names already in mixed case stay as they are; CORE / ORBIT stay names. */
export function displayName(name: string): string {
  const s = name.trim();
  if (!s || s !== s.toLocaleUpperCase() || /^(CORE|ORBIT|AI)$/.test(s)) return s;
  const low = s.toLocaleLowerCase();
  return low[0].toLocaleUpperCase() + low.slice(1);
}

const R = {
  en: { jobs: (n: number) => `${n} job${n === 1 ? "" : "s"}`, needs: (n: number) => `${n} need${n === 1 ? "s" : ""} you`, broke: (n: number) => (n === 1 ? "1 problem" : `${n} problems`),
    left: (m: number) => (m <= 1 ? "almost done" : m < 120 ? `${m} min left` : `${Math.round(m / 60)} h left`) },
  et: { jobs: (n: number) => `${n} töös`, needs: (n: number) => `${n} vajab sind`, broke: (n: number) => (n === 1 ? "1 probleem" : `${n} probleemi`),
    left: (m: number) => (m <= 1 ? "kohe valmis" : m < 120 ? `${m} min veel` : `${Math.round(m / 60)} h veel`) },
} as const;
const cap = (n: number) => (n > 9 ? 9 : n); // "9+" handled by the caller's badge; readouts stay short

/** One short line under a planet's name: problems first, then what needs him, then running jobs with time left. "" when idle. */
export function planetReadout(st: WorldStatus | undefined, lang: Lang): string {
  if (!st || st.state === "idle") return "";
  const w = R[lang] ?? R.en, parts: string[] = [];
  if (st.broke) parts.push(w.broke(cap(st.broke)));
  if (st.needs) parts.push(w.needs(cap(st.needs)));
  if (st.working) parts.push(st.working > 9 ? w.jobs(10).replace("10", "9+") : w.jobs(st.working));
  if (st.working && st.leftMin !== null && Number.isFinite(st.leftMin) && st.leftMin > 0 && parts.length < 3) parts.push(w.left(Math.ceil(st.leftMin)));
  return parts.slice(0, 3).join(" · ");
}

/** A count for a badge: "" for 0 or less, "9+" past nine. */
export const badge = (n: number | null | undefined) => (!n || !Number.isFinite(n) || n <= 0 ? "" : n > 9 ? "9+" : String(Math.floor(n)));

/** Voice meter: n bar heights (0.15..1) for a mic level 0..1 at time t (s). Quiet → a low flat line; louder → taller, with a
 *  little travelling wave so it reads as live. Non-finite input → flat. */
export function meterBars(level: number, t: number, n = 9): number[] {
  const l = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0, tt = Number.isFinite(t) ? t : 0;
  return Array.from({ length: n }, (_, i) => {
    const centre = 1 - Math.abs(i - (n - 1) / 2) / ((n - 1) / 2 + 1); // taller in the middle
    const wave = 0.65 + 0.35 * Math.sin(tt * 9 + i * 1.3);
    return Math.round(Math.min(1, Math.max(0.15, 0.15 + l * 0.85 * centre * wave * 1.25)) * 100) / 100;
  });
}

/** Needs-you card body: the item's detail, then the question ("… is ready. Approve or reject this exact version?") with
 *  exactly one sentence end between them (no ".." when the detail already ends with punctuation). */
export function joinDetail(detail: string | null | undefined, ask: string): string {
  const d = (detail ?? "").trim();
  if (!d) return ask;
  if (!ask) return d;
  return /[.!?…:]$/.test(d) ? `${d} ${ask}` : `${d}. ${ask}`;
}
