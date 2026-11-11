// Audio briefing (Podcastfy idea, done with ORBIT's own free voices): a Pulse briefing becomes a short two-voice show. The anchor
// reads each story's headline and what happened; the analyst adds why it matters and flags single-source stories. Built from the
// briefing's own text only (no new facts), citations and Markdown stripped for speech. Audio side: briefing-audio.ts (Kokoro).
// Tests: tests/briefing-audio.test.ts.

export type Line = { who: "anchor" | "analyst"; text: string };
export const VOICES = { anchor: "af_heart", analyst: "am_michael" } as const;
const MAX_STORIES = 8, MAX_SENTENCES = 3;

/** Markdown and citations out, so the voice reads clean prose. */
export const speech = (s: string) => s.replace(/\[a:[^\]]+\]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`#>]/g, "")
  .replace(/https?:\/\/\S+/g, "").replace(/\s+([.,;:!?])/g, "$1").replace(/\s+/g, " ").trim();
const sentences = (s: string) => (s.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? []).map((x) => x.trim()).filter(Boolean);

export type Story = { section: string; headline: string; single: boolean; facts: string[]; why: string };
/** Stories from the briefing Markdown: "## Section", "### Headline — Confirmed|Single source", body, "Why it matters: …". */
export function stories(md: string): Story[] {
  const out: Story[] = [];
  let section = "", cur: Story | null = null;
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (/^##\s/.test(line) && !/^###/.test(line)) { section = speech(line.replace(/^##\s*/, "")); cur = null; continue; }
    const h = /^###\s*(.+?)(?:\s+[—-]\s+(Confirmed|Single source))?\s*$/i.exec(line);
    if (h) { cur = { section, headline: speech(h[1]), single: /single/i.test(h[2] ?? ""), facts: [], why: "" }; out.push(cur); continue; }
    if (!cur || !line) continue;
    const why = /why it matters:\s*(.+)$/i.exec(line);
    const body = speech(why ? line.slice(0, why.index) : line);
    if (body) cur.facts.push(...sentences(body));
    if (why) cur.why = speech(why[1]);
  }
  return out.filter((s) => s.headline && s.facts.length).slice(0, MAX_STORIES);
}

/** The show: intro, each story as anchor + analyst, the next-steps section, outro. */
export function script(title: string, md: string, when = "today"): Line[] {
  const st = stories(md), lines: Line[] = [{ who: "anchor", text: `This is your ORBIT briefing for ${when}: ${speech(title)}. ${st.length} ${st.length === 1 ? "story" : "stories"}.` }];
  let lastSection = "";
  for (const s of st) {
    const lead = s.section && s.section !== lastSection ? `${s.section}. ` : ""; lastSection = s.section;
    lines.push({ who: "anchor", text: `${lead}${s.headline}. ${s.facts.slice(0, MAX_SENTENCES).join(" ")}`.trim() });
    const note = [s.why && `Why it matters: ${s.why}`, s.single && "Worth saying: that's from one outlet so far, so treat it as reported, not confirmed."].filter(Boolean).join(" ");
    if (note) lines.push({ who: "analyst", text: note });
  }
  const next = /##\s*Suggested next steps\s*\n([\s\S]*?)(?:\n##\s|$)/i.exec(md)?.[1];
  const steps = (next ?? "").split("\n").map((l) => speech(l.replace(/^\s*(?:[-*]|\d+\.)\s*/, ""))).filter(Boolean).slice(0, 3);
  if (steps.length) lines.push({ who: "analyst", text: `To follow up: ${steps.join(" Also: ")}` });
  lines.push({ who: "anchor", text: "That's the briefing. The full text with sources is in ORBIT." });
  return lines.map((l) => ({ ...l, text: l.text.slice(0, 900) }));
}
/** Seconds of silence after a line: longer when the speaker changes. */
export const gapAfter = (a: Line, b?: Line) => (!b ? 0 : a.who === b.who ? 0.35 : 0.55);
