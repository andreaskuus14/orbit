// INTELLIGENCE one surface (tests: tests/briefing-view.test.ts). A stored briefing (pulse.ts format: "## Section",
// "### Story — Confirmed|Single source", sentences with [a:<id>] citations, fact check marks in brackets and a "_Fact check: …_"
// line at the end) → sections of stories for the panel. The marks leave the text and become each story's trust: a quiet
// level plus the evidence behind it (which outlets, read in full or not, which sentences didn't check out). Old briefings
// (no marks, no labels, bullets) parse too. The stored text is never changed: CORE's memory copy keeps the marks.
import { FLAG, ONE_SOURCE } from "./factcheck-pure.ts";
import { checkClaims, type Evidence } from "./news-intel-pure.ts";

export type Cite = Evidence & { title: string; source: string | null };
export type Flag = { sentence: string; kind: "not_backed" | "one_source" | "number" | "missing_source"; detail?: string };
export type Story = { title: string | null; label: "confirmed" | "single" | null; lines: string[]; cites: string[]; flags: Flag[] };
export type Section = { heading: string; kind: "for_you" | "world" | "next"; stories: Story[] };
export type Parsed = { sections: Section[]; removed: number };
export type Trust = { level: "confirmed" | "single" | "check"; outlets: number; read: number; cited: number; flags: Flag[] };

const CITE = /\[a:([0-9a-f-]{36})\]/gi;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MARKS: [RegExp, Flag["kind"]][] = [
  [new RegExp(`\\s*\\((?:${esc(FLAG.en)}|${esc(FLAG.et)})\\)`, "gi"), "not_backed"],
  [new RegExp(`\\s*\\((?:${esc(ONE_SOURCE.en)}|${esc(ONE_SOURCE.et)})\\)`, "gi"), "one_source"],
];
const NOTE = /^_?(?:Fact check|Faktikontroll):/i;
const LABEL = /\s+[—–-]\s+(Confirmed|Single source|Kinnitatud|Üks allikas)\s*$/i;

/** Plain sentence for the evidence list: no citations, bold or list marker. */
const plain = (s: string) => s.replace(CITE, "").replace(/\*\*/g, "").replace(/^\s*([-*]|\d+\.)\s+/, "").replace(/\s+([.,;:!?])/g, "$1").replace(/\s+/g, " ").trim();

/** One line without its fact check marks, and the flags they stood for (one per marked sentence). */
export function stripMarks(line: string): { text: string; flags: Flag[] } {
  const flags: Flag[] = [];
  const sentences = line.split(/(?<=[.!?])\s+/);
  const out = sentences.map((s) => {
    let t = s;
    for (const [re, kind] of MARKS) if (re.test(t)) { re.lastIndex = 0; t = t.replace(re, ""); flags.push({ sentence: plain(t), kind }); }
    for (const [re] of MARKS) re.lastIndex = 0;
    return t;
  });
  return { text: out.join(" "), flags };
}

const sectionKind = (h: string): Section["kind"] => (/^(for you|sinule|sulle)\b/i.test(h) ? "for_you" : /next steps|järgmised sammud/i.test(h) ? "next" : "world");

export function parseBriefing(content: string): Parsed {
  const sections: Section[] = [];
  let removed = 0, sec: Section | null = null, story: Story | null = null;
  const newStory = (title: string | null): Story => {
    if (!sec) { sec = { heading: "", kind: "world", stories: [] }; sections.push(sec); }
    const m = title?.match(LABEL);
    const s: Story = { title: title ? plain(title.replace(LABEL, "")) || null : null, label: m ? (/^(confirmed|kinnitatud)$/i.test(m[1]) ? "confirmed" : "single") : null, lines: [], cites: [], flags: [] };
    sec.stories.push(s);
    return s;
  };
  for (const raw of content.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    if (NOTE.test(l)) { // the fact check's own summary: its "removed" count is kept, the rest is shown per story
      const n = l.match(/removed (\d+)|eemaldasin (\d+)/i);
      if (n) removed += Number(n[1] ?? n[2]);
      continue;
    }
    if (l.startsWith("## ")) { sec = { heading: l.slice(3).trim(), kind: sectionKind(l.slice(3).trim()), stories: [] }; sections.push(sec); story = null; continue; }
    if (l.startsWith("### ")) { story = newStory(l.slice(4).trim()); continue; }
    if (!story) story = newStory(null);
    const { text, flags } = stripMarks(l);
    story.lines.push(text);
    story.flags.push(...flags);
    for (const m of l.matchAll(CITE)) { const id = m[1].toLowerCase(); if (!story.cites.includes(id)) story.cites.push(id); }
  }
  const order = { for_you: 0, world: 1, next: 2 } as const;
  const kept = sections.filter((s) => s.stories.some((x) => x.lines.length || x.title));
  return { sections: kept.map((s, i) => ({ s, i })).sort((a, b) => order[a.s.kind] - order[b.s.kind] || a.i - b.i).map((x) => x.s), removed };
}

const OUTLET = (s: string | null) => (s ?? "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");

/** A story's trust: "check" when a sentence didn't hold up against its sources, "confirmed" with 2+ outlets (or the model's
 *  own label backed by them), else "single". Number checks (INT03) run only where the citations carry evidence. */
export function storyTrust(story: Story, cites: Cite[]): Trust {
  const mine = story.cites.map((id) => cites.find((c) => c.id === id)).filter((c): c is Cite => !!c);
  const outlets = new Set(mine.map((c) => OUTLET(c.source) || c.id)).size;
  const read = mine.filter((c) => c.evidence === "fetched").length;
  const flags = [...story.flags];
  if (cites.some((c) => c.evidence)) {
    for (const c of checkClaims(story.lines.join("\n"), cites)) {
      if (c.ok) continue;
      const sentence = plain(c.sentence);
      const num = c.what.match(/^number\(s\) (.+) not found/);
      const f: Flag = num ? { sentence, kind: "number", detail: num[1] } : /not in the briefing/.test(c.what) ? { sentence, kind: "missing_source" } : { sentence, kind: "not_backed" };
      if (!flags.some((x) => x.sentence === sentence && (x.kind === f.kind || x.kind === "not_backed"))) flags.push(f);
    }
  }
  const bad = flags.some((f) => f.kind !== "one_source");
  const level = bad ? "check" : outlets >= 2 ? "confirmed" : "single";
  return { level, outlets, read, cited: mine.length, flags };
}

/** What the panel says about the last run: state and time, plus the error text for a failed run. Never the run's counters. */
export function runLine(job: { status: string; detail: string | null; started_at: string } | undefined | null):
  { state: "running" | "failed" | "done"; at: string; error?: string } | null {
  if (!job) return null;
  const state = job.status === "failed" ? "failed" : job.status === "running" ? "running" : "done";
  const error = state === "failed" && job.detail ? job.detail.replace(/^(manual|morning|midday|evening|weekly)[^:]{0,12}:\s*/i, "").trim() || undefined : undefined;
  return { state, at: job.started_at, ...(error && { error }) };
}

/** Feedback key for a briefing story (the vote store takes any key; the title drives the ranking check). */
export const storyKey = (briefingId: string, title: string) => `b:${briefingId}:${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 120)}`;

/** The one-line summary under a headline: the story's first sentence, plain (no citations, no bold), at most `max` chars. */
export function summaryOf(story: Story, max = 170): string {
  const text = story.lines.map((l) => l.replace(/\[a:[0-9a-f-]{36}\]/gi, "").replace(/\*\*/g, "").replace(/^\s*([-*]|\d+\.)\s+/, "")).join(" ").replace(/\s+([.,;:!?])/g, "$1").replace(/\s+/g, " ").trim();
  const first = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  return first.length <= max ? first : `${first.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

/** "Reuters, AP and 4 more": the distinct outlets a story cites, in citation order. */
export function outletsOf(story: Story, cites: Cite[]): { names: string[]; more: number } {
  const seen = new Map<string, string>();
  for (const id of story.cites) {
    const c = cites.find((x) => x.id === id);
    const name = c?.source?.trim();
    if (name && !seen.has(OUTLET(name))) seen.set(OUTLET(name), name);
  }
  const all = [...seen.values()];
  return { names: all.slice(0, 2), more: Math.max(0, all.length - 2) };
}

/** A story's coverage over the last `hours`, in `bins` equal slices (oldest first), from real report times (its cited articles
 *  and the clustered reports of the same event). null when fewer than 3 reports fall inside: too few to draw a line honestly. */
export function coverage(times: (string | null | undefined)[], now: number, hours = 24, bins = 12): number[] | null {
  const span = hours * 3_600_000, out = Array.from({ length: bins }, () => 0);
  let n = 0;
  for (const s of times) {
    const t = s ? Date.parse(s) : NaN;
    if (!Number.isFinite(t) || t > now || now - t >= span) continue;
    out[Math.min(bins - 1, Math.floor((t - (now - span)) / (span / bins)))]++; n++;
  }
  return n >= 3 ? out : null;
}
