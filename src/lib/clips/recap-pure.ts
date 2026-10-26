// Daily recap reel (pure, tested in tests/recap.test.ts): ORBIT's own day as a 25 s vertical video of animated title cards on a
// generated gradient, rendered locally by ffmpeg (no model, no Higgsfield). IO: recap.ts (night shift + morning brief). Never posted:
// originalityIssue (publish-checks-pure.ts) refuses every publish path for a recap job. Reads ledger counts and ORBIT's own titles
// (tasks, Shorts, goal steps), never journal or LIFE data.
import type { LedgerEvent } from "../ledger-pure.ts";
import { assText, assTime } from "./pure.ts";
import { RECAP_SOURCE } from "./publish-checks-pure.ts";

export const RECAP_SEC = 25, INTRO = 2.5, OUTRO = 2, MAX_CARDS = 6;
export const recapSource = (day: string) => RECAP_SOURCE + day;
export const isRecap = (job: { source?: string }) => !!job.source?.startsWith(RECAP_SOURCE);

export type RecapIn = { events: LedgerEvent[]; tasksDone: string[]; archVersions: number }; // already limited to the day
export type Card = { big: string; label: string; sub?: string };

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
// Arial in libass has no emoji: keep letters, numbers, punctuation and spaces only, cut on a word.
const clean = (s: string, max = 38) => {
  const t = s.replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, "").replace(/^\s*Tonight:\s*/i, "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max + 1).replace(/\s+\S*$/, "").replace(/[\s,.:;!-]+$/, "") + "…" : t;
};

/** The day's highlights, most interesting first; zero counts are left out. Empty = nothing worth a reel. */
export function pickHighlights(x: RecapIn): Card[] {
  const ev = <T extends LedgerEvent["type"]>(t: T) => x.events.filter((e): e is Extract<LedgerEvent, { type: T }> => e.type === t);
  const shorts = ev("clip.published"), steps = ev("goal.step").filter((e) => e.data.status === "done");
  const goals = new Set(steps.map((e) => e.data.goalId)).size, deals = ev("deal.found").length;
  const focus = Math.round(ev("focus.session").reduce((s, e) => s + e.data.minutes, 0));
  const first = (xs: (string | undefined)[]) => { const t = xs.map((s) => clean(s ?? "")).find(Boolean); return t ? { sub: t } : {}; };
  const cards: (Card | false)[] = [
    shorts.length > 0 && { big: String(shorts.length), label: `${plural(shorts.length, "Short")} published`, ...first(shorts.map((e) => e.data.title)) },
    x.tasksDone.length > 0 && { big: String(x.tasksDone.length), label: `${plural(x.tasksDone.length, "task")} done`, ...first(x.tasksDone) },
    goals > 0 && { big: String(goals), label: `${plural(goals, "goal")} moved`, ...first(steps.map((e) => e.data.step)) },
    deals > 0 && { big: String(deals), label: `${plural(deals, "deal")} found` },
    x.archVersions > 0 && { big: String(x.archVersions), label: `ARCH ${plural(x.archVersions, "version")} saved` },
    focus > 0 && { big: String(focus), label: `focus ${plural(focus, "minute")}` },
  ];
  return cards.filter((c): c is Card => !!c).slice(0, MAX_CARDS);
}

export type Slot = { start: number; end: number };
/** Intro, one slot per card, outro: always RECAP_SEC long ("Yesterday in 25 seconds"), cards share what's left evenly. */
export function cardTiming(n: number): { intro: Slot; cards: Slot[]; outro: Slot } {
  const per = (RECAP_SEC - INTRO - OUTRO) / Math.max(1, n), r = (t: number) => Math.round(t * 100) / 100;
  return { intro: { start: 0, end: INTRO }, cards: Array.from({ length: n }, (_, i) => ({ start: r(INTRO + i * per), end: r(INTRO + (i + 1) * per) })), outro: { start: RECAP_SEC - OUTRO, end: RECAP_SEC } };
}

/** "Mon 26 Oct" for the intro card. */
export const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** The title cards as ASS: each card's number pops in (scale), its label and title fade up; every card fades out. */
export function recapAss(cards: Card[], day: string): string {
  const t = cardTiming(cards.length), ev: string[] = [];
  const line = (s: Slot, style: string, text: string, fx: string) => ev.push(`Dialogue: 0,${assTime(s.start)},${assTime(s.end)},${style},,0,0,0,,${fx}${text}`);
  const pop = "{\\fad(250,300)\\fscx60\\fscy60\\t(0,280,\\fscx100\\fscy100)}", rise = (y: number) => `{\\fad(400,300)\\move(540,${y + 40},540,${y},0,400)}`;
  line(t.intro, "Label", "YESTERDAY IN", rise(780));
  line(t.intro, "Big", "25 SECONDS", `{\\pos(540,960)\\fs150}${pop}`);
  line(t.intro, "Sub", assText(dayLabel(day)), rise(1120));
  cards.forEach((c, i) => {
    const s = t.cards[i];
    line(s, "Big", assText(c.big), `{\\pos(540,880)}${pop}`);
    line(s, "Label", assText(c.label).toUpperCase(), rise(1080));
    if (c.sub) line(s, "Sub", assText(c.sub), rise(1200));
  });
  line(t.outro, "Label", "ORBIT", rise(900));
  line(t.outro, "Sub", "see you tonight", rise(1010));
  return [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Big,Arial,300,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,0,6,5,60,60,0,1",
    "Style: Label,Arial,78,&H00F5D6A8,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,4,0,1,0,4,5,60,60,0,1",
    "Style: Sub,Arial,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,3,5,80,80,0,1",
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ...ev, "",
  ].join("\n");
}

/** ffmpeg args (an array, never a shell; run with cwd = the job folder so the .ass path needs no escaping): a slow-moving
 *  galaxy-coloured gradient, the cards burned in, and a soft music bed or silence. */
export function recapArgs(o: { ass: string; music?: string; out: string }): string[] {
  const d = RECAP_SEC;
  const bg = `gradients=s=1080x1920:r=30:d=${d}:nb_colors=3:c0=0x0b1026:c1=0x3b1d6e:c2=0x0e3a5c:x0=0:y0=0:x1=1080:y1=1920:speed=0.001`;
  const audio = o.music
    ? ["-stream_loop", "-1", "-i", o.music]
    : ["-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo`];
  const a = o.music ? `[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.15,atrim=0:${d},afade=t=in:d=1,afade=t=out:st=${d - 2}:d=2[a]` : `[1:a]atrim=0:${d}[a]`;
  return ["-y", "-hide_banner", "-f", "lavfi", "-i", bg, ...audio,
    "-filter_complex", `[0:v]ass=${o.ass},format=yuv420p[v];${a}`, "-map", "[v]", "-map", "[a]", "-t", String(d),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-r", "30", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", o.out];
}

