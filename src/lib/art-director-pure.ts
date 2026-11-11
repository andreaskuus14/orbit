// The art director: judges visual quality (taste, not just "is it blank") of website screenshots, STUDIO frames and ARCH renders.
// Two halves: measured pixel facts (contrast, palette spread, where the detail sits) that no opinion can override, and a vision-model
// critique against a fixed rubric that must name what it sees and how to fix it. The verdict is computed here from the scores, never
// taken from the model. Disk/model side: art-director.ts. Standard it applies: site-guide.ts CINEMATIC STANDARD. Tests: art-director.test.ts.

export type ArtKind = "site" | "frames" | "render";
export type Criterion = { id: string; name: string; ask: string; weight: number; kinds: ArtKind[] };

/** What a working art director checks, in the order they'd look. weight: how much it moves the score. */
export const CRITERIA: Criterion[] = [
  { id: "focal", name: "Focal point", weight: 3, kinds: ["site", "frames", "render"], ask: "Is there one clear subject the eye lands on first, filling the frame (not a small object in an empty field)?" },
  { id: "composition", name: "Composition and depth", weight: 3, kinds: ["site", "frames", "render"], ask: "Deliberate camera/layout: foreground, mid and background for depth, a strong angle, framed like a poster?" },
  { id: "light", name: "Light and mood", weight: 3, kinds: ["site", "frames", "render"], ask: "One deliberate time of day or mood with real contrast and a colour grade; flat overcast grey reads unfinished." },
  { id: "palette", name: "Palette discipline", weight: 2, kinds: ["site", "frames", "render"], ask: "A small, intentional palette (a dominant, a support, one accent) used consistently; no random colours." },
  { id: "hierarchy", name: "Hierarchy", weight: 3, kinds: ["site"], ask: "One obvious first read, then a second, then details; the main action is easy to find." },
  { id: "type", name: "Typography", weight: 2, kinds: ["site"], ask: "Clear scale contrast between display and body, steady rhythm and spacing, readable line length, type working with the image." },
  { id: "legibility", name: "Legibility", weight: 2, kinds: ["site", "frames"], ask: "All text readable over its background at this size (contrast, scrims, size)." },
  { id: "space", name: "Negative space", weight: 1, kinds: ["site", "render"], ask: "Empty space is intentional and gives the subject room, not leftover gaps or cramming." },
  { id: "consistency", name: "Consistency", weight: 2, kinds: ["frames", "site"], ask: "Across the images: same art direction, grade, characters/objects and type, so they read as one piece." },
  { id: "craft", name: "Craft and originality", weight: 3, kinds: ["site", "frames", "render"], ask: "No stand-in or template look (generic gradient hero + three cards, stock poses), no AI tells (warped text or hands, plastic skin, melted objects, floating furniture, impossible geometry)." },
];
export const criteriaFor = (kind: ArtKind) => CRITERIA.filter((c) => c.kinds.includes(kind));

// ---- Measured facts (computed in the browser from each image's pixels, see art-director.ts) ----
/** lum: mean luminance 0-1; spread: luminance standard deviation 0-1; colours: distinct 4-bit-per-channel colour buckets holding
 *  ≥1 % of pixels; centre: share of edge detail in the middle third (0-1); clipped: share of pure black/white pixels. */
export type Measure = { w: number; h: number; lum: number; spread: number; colours: number; centre: number; clipped: number };

/** Objective notes from the pixels. hard = the image can't ship as is whatever the critique says. */
export function measuredNotes(ms: Measure[], kind: ArtKind): { note: string; hard: boolean }[] {
  const out: { note: string; hard: boolean }[] = [];
  ms.forEach((m, i) => {
    const n = ms.length > 1 ? `Image ${i + 1}: ` : "";
    if (m.spread < 0.08) out.push({ note: `${n}almost no tonal contrast (spread ${m.spread.toFixed(2)}); it reads flat and grey: add a light source, darker shadows or a grade`, hard: m.spread < 0.04 });
    // white page backgrounds and black text are normal on a site, so clipping only counts for frames and renders
    if (m.clipped > 0.25 && kind !== "site") out.push({ note: `${n}${Math.round(m.clipped * 100)} % of pixels are pure black or white; detail is lost: lift the shadows or pull back the highlights`, hard: m.clipped > 0.5 });
    if (m.colours > 48 && kind !== "site") out.push({ note: `${n}${m.colours} competing colour groups; pick a dominant, a support and one accent and grade toward them`, hard: false });
    if (m.centre < 0.12 && kind !== "site") out.push({ note: `${n}the detail sits at the edges and the middle is empty; move the subject in or crop tighter`, hard: false });
    if (Math.max(m.w, m.h) < 1000 && kind !== "site") out.push({ note: `${n}only ${m.w}×${m.h} px; too small to judge or ship, render at least 1600 px wide`, hard: true });
  });
  if (kind === "frames" && ms.length > 1) {
    const lums = ms.map((m) => m.lum), jump = Math.max(...lums) - Math.min(...lums);
    if (jump > 0.45) out.push({ note: `brightness jumps ${jump.toFixed(2)} between frames; grade them to one mood`, hard: false });
  }
  return out;
}

// ---- The critique the vision model must return ----
export const ART_SYSTEM = `You are a senior art director reviewing work before it ships. Judge only what is visible in the images.
Score each criterion 1-5 against an award-level bar (3 = acceptable professional work, 5 = would win an award, 1 = must be redone).
For every criterion write "evidence": what you actually see that earns the score, naming the specific element and where it is
(e.g. "the headline sits on the bright sky at top left and loses contrast"), and "fix": one concrete instruction a designer can act on
("darken the sky behind the headline with a 40 % scrim"). Never write generic praise or generic advice ("improve composition",
"make it pop", "consider adjusting"). Output ONLY JSON, no prose, no code fences:
{"criteria":[{"id":string,"score":1-5,"evidence":string,"fix":string}],"strongest":string,"biggest_gap":string}`;

export function artPrompt(kind: ArtKind, count: number, context = ""): string {
  const what = { site: "screenshots of one website at different widths", frames: "key frames from one video, in order", render: "architectural renders of one project" }[kind];
  return [`These ${count} images are ${what}.${context ? ` Context: ${context.slice(0, 400)}` : ""}`,
    "Score exactly these criteria (use these ids):", ...criteriaFor(kind).map((c) => `- ${c.id} (${c.name}): ${c.ask}`)].join("\n");
}

export type Scored = { id: string; score: number; evidence: string; fix: string };
export type Critique = { criteria: Scored[]; strongest: string; gap: string };

const VAGUE = /\b(?:looks? (?:good|great|nice|fine)|make it pop|consider|could be (?:improved|better)|improve (?:the )?(?:composition|design|visuals?|layout|colou?rs?)|enhance|more (?:engaging|appealing|dynamic|modern)|well done|nice job|various|some elements|certain areas)\b/i;
// Weak openers turn a fix into advice ("consider…", "try to…", "improve…"); a real fix starts with the change itself.
const WEAK = /^(?:consider|try|maybe|perhaps|possibly|think|could|should|would|might|improve|enhance|ensure|optimi[sz]e|explore|look into|experiment|work on|focus on|it|this|the|overall)\b/i;

/** Strict parse: every criterion for this kind, integer 1-5, specific evidence and an actionable fix. Errors name what to redo. */
export function parseCritique(text: string, kind: ArtKind): { critique: Critique } | { errors: string[] } {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  let j: unknown; try { j = s >= 0 && e > s ? JSON.parse(text.slice(s, e + 1)) : null; } catch { j = null; }
  if (!j || typeof j !== "object" || !Array.isArray((j as { criteria?: unknown }).criteria)) return { errors: ["reply was not the JSON object with a criteria array"] };
  const raw = (j as { criteria: unknown[] }).criteria, errors: string[] = [], out: Scored[] = [];
  for (const c of criteriaFor(kind)) {
    const r = raw.find((x) => x && typeof x === "object" && (x as { id?: unknown }).id === c.id) as Partial<Scored> | undefined;
    if (!r) { errors.push(`${c.id}: missing`); continue; }
    const ev = typeof r.evidence === "string" ? r.evidence.trim() : "", fix = typeof r.fix === "string" ? r.fix.trim() : "";
    if (!Number.isInteger(r.score) || (r.score as number) < 1 || (r.score as number) > 5) errors.push(`${c.id}: score must be a whole number 1-5`);
    if (ev.length < 25 || VAGUE.test(ev)) errors.push(`${c.id}: evidence is vague; name the element you see and where it is`);
    if (fix.length < 15 || VAGUE.test(fix) || WEAK.test(fix)) errors.push(`${c.id}: fix must start with a concrete action (e.g. "darken…", "crop…", "move…")`);
    out.push({ id: c.id, score: r.score as number, evidence: ev.slice(0, 300), fix: fix.slice(0, 300) });
  }
  if (errors.length) return { errors };
  const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 300) : "");
  return { critique: { criteria: out, strongest: str((j as { strongest?: unknown }).strongest), gap: str((j as { biggest_gap?: unknown }).biggest_gap) } };
}

export type Verdict = "ship" | "revise" | "redo";
export type ArtReport = { score: number; verdict: Verdict; fixes: string[]; strongest: string; gap: string; criteria: Scored[] };

/** Weighted 0-100 score and a verdict the model can't talk its way around: any 1 or a hard pixel fact → redo; any 2 or <70 → revise. */
export function artVerdict(c: Critique, notes: { note: string; hard: boolean }[], kind: ArtKind): ArtReport {
  const w = new Map(criteriaFor(kind).map((x) => [x.id, x.weight]));
  const tw = c.criteria.reduce((s, x) => s + (w.get(x.id) ?? 0), 0);
  const score = Math.round((c.criteria.reduce((s, x) => s + (w.get(x.id) ?? 0) * (x.score - 1), 0) / (tw * 4)) * 100);
  const low = Math.min(...c.criteria.map((x) => x.score));
  const verdict: Verdict = low <= 1 || score < 45 || notes.some((n) => n.hard) ? "redo" : low <= 2 || score < 70 || notes.length > 0 ? "revise" : "ship";
  const name = new Map(CRITERIA.map((x) => [x.id, x.name]));
  const fixes = [...notes.map((n) => n.note), ...[...c.criteria].filter((x) => x.score <= 3).sort((a, b) => a.score - b.score || (w.get(b.id) ?? 0) - (w.get(a.id) ?? 0)).map((x) => `${name.get(x.id)} (${x.score}/5): ${x.fix}`)];
  return { score, verdict, fixes: fixes.slice(0, 8), strongest: c.strongest, gap: c.gap, criteria: c.criteria };
}

/** A short Markdown report for a QA packet or a chat reply. */
export function artMarkdown(r: ArtReport): string {
  const name = new Map(CRITERIA.map((x) => [x.id, x.name]));
  return [`## Art direction: ${r.verdict.toUpperCase()} (${r.score}/100)`, ...(r.strongest ? [`Strongest: ${r.strongest}`] : []), ...(r.gap ? [`Biggest gap: ${r.gap}`] : []), "",
    "| Criterion | Score | What it shows |", "|---|---|---|", ...r.criteria.map((x) => `| ${name.get(x.id)} | ${x.score}/5 | ${x.evidence.replace(/\|/g, "/")} |`),
    "", r.fixes.length ? "Fixes, most important first:" : "No fixes needed.", ...r.fixes.map((f, i) => `${i + 1}. ${f}`)].join("\n");
}
