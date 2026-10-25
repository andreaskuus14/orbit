// Pet-sim backlog (roadmap 4.4), pure: import a pasted list or GitHub issues text into the GAME DEV bug tracker as bugs/features/polish
// with priority, sort it, and turn one item into a Goal body for the existing goals API. Tested in tests/backlog.test.ts.
import { MAX_BUGS, PRIORITIES, type Bug, type DevWorld, type Game, type Kind, type Priority, type Severity, type Status } from "./devworld-pure.ts";

export type Draft = { title: string; detail: string; kind: Kind; priority: Priority; severity: Severity; status: Status; ref?: string };
export const MAX_IMPORT = 100;

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const KIND_WORDS: [RegExp, Kind][] = [[/^(bug|defect|crash|error|broken|fix)$/i, "bug"], [/^(feature|enhancement|feat|idea|request|todo|add)$/i, "feature"], [/^(polish|ui|ux|cleanup|chore|art|sound|juice|style)$/i, "polish"]];
const PRIO_WORDS: [RegExp, Priority][] = [[/^(p0|p1|high|urgent|critical|blocker|priority:\s*high|high priority)$/i, "high"], [/^(p2|medium|med|normal|priority:\s*medium)$/i, "medium"], [/^(p3|p4|low|later|nice to have|priority:\s*low|low priority)$/i, "low"]];
const kindOf = (t: string) => KIND_WORDS.find(([re]) => re.test(t.trim()))?.[1];
const prioOf = (t: string) => PRIO_WORDS.find(([re]) => re.test(t.trim()))?.[1];

/** Tags and labels: [bug] (P1) #feature, "bug:" prefix, or a GitHub labels column ("bug, priority: high"). */
function tags(raw: string[]): { kind?: Kind; priority?: Priority; crash: boolean } {
  let kind: Kind | undefined, priority: Priority | undefined, crash = false;
  for (const t of raw) {
    kind ??= kindOf(t); priority ??= prioOf(t);
    if (/^crash/i.test(t.trim())) crash = true;
  }
  return { kind, priority, crash };
}

function draft(title: string, detail: string, t: ReturnType<typeof tags>, done: boolean, ref?: string): Draft | null {
  const tl = clean(title, 140);
  if (tl.length < 2) return null;
  const kind = t.kind ?? (/\b(crash|bug|broken|error|fails?|doesn'?t|not working|twice|wrong|exploit|dupe)\b/i.test(tl) ? "bug" : /\b(add|implement|new|support)\b/i.test(tl) ? "feature" : "bug");
  const severity: Severity = t.crash || /\bcrash/i.test(tl) ? "crash" : kind === "polish" ? "polish" : kind === "feature" ? "minor" : "major";
  return { title: tl, detail: clean(detail, 2000), kind, priority: t.priority ?? "medium", severity, status: done ? "fixed" : "open", ...(ref && { ref }) };
}

/** Pasted text → drafts. Understands: bullet/numbered/checkbox lists with optional [tags] and "title — detail";
 *  `gh issue list` output (tab or 2+-space columns: number, state, title, labels, date); GitHub web copies ("Title" then "#12 opened … by …"). */
export function parseBacklog(text: string): Draft[] {
  const out: Draft[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (const raw of lines) {
    if (!raw.trim() || /^\s*(#{1,6}\s|title\s+labels|showing \d+ of)/i.test(raw)) continue; // markdown headings, gh headers
    // GitHub web copy: "#12 opened 3 days ago by x" (or "closed") belongs to the line before.
    const web = /^\s*#(\d+)\s+(opened|was closed|closed|by)\b/i.exec(raw);
    if (web) { const prev = out.at(-1); if (prev && !prev.ref) { prev.ref = `#${web[1]}`; if (/closed/i.test(web[2])) prev.status = "fixed"; } continue; }
    // Indented continuation of a list item → its detail.
    if (/^\s{2,}\S/.test(raw) && !/^\s*([-*•+]|\d+[.)])\s/.test(raw) && out.length && !/\t/.test(raw)) {
      const prev = out.at(-1)!; prev.detail = clean(`${prev.detail} ${raw}`, 2000); continue;
    }
    const cols = raw.split(/\t|\s{2,}/).map((c) => c.trim()).filter(Boolean);
    const num = cols[0] && /^#?\d+$/.test(cols[0]) ? cols[0].replace("#", "") : null;
    if (num && cols.length >= 2) { // gh issue list
      let i = 1, done = false;
      if (/^(open|closed)$/i.test(cols[i] ?? "")) { done = /closed/i.test(cols[i]); i++; }
      const title = cols[i] ?? "", labels = (cols[i + 1] ?? "").split(",").filter((l) => !/\b(ago|\d{4}-\d{2}-\d{2})/.test(l));
      const d = draft(title, "", tags(labels), done, `#${num}`);
      if (d) out.push(d);
    } else {
      let line = raw.replace(/^\s*([-*•+]|\d+[.)])\s+/, "");
      const box = /^\[( |x|X)\]\s*/.exec(line);
      if (box) line = line.slice(box[0].length);
      const found: string[] = [];
      line = line.replace(/\[([^\]]{1,30})\]|\(((?:p\d|high|medium|med|low|urgent)[^)]{0,10})\)|(?:^|\s)#([a-z][\w-]{1,20})\b/gi, (_, a, b, c) => { found.push(a ?? b ?? c); return " "; });
      const pre = /^\s*(bug|feature|polish|feat|ui|fix|todo)\s*:\s*/i.exec(line);
      if (pre) { found.push(pre[1]); line = line.slice(pre[0].length); }
      const ref = /\(#(\d+)\)\s*$|\s#(\d+)\s*$/.exec(line);
      if (ref) line = line.slice(0, ref.index);
      const [title, ...rest] = line.split(/\s+(?:—|–|--|\|)\s+/);
      const d = draft(title, rest.join(" — "), tags(found), box?.[1].toLowerCase() === "x", ref ? `#${ref[1] ?? ref[2]}` : undefined);
      if (d) out.push(d);
    }
    if (out.length >= MAX_IMPORT) break;
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Adds drafts to one game; an item already there (same title, or same issue ref) is skipped. Stops at MAX_BUGS. */
export function importDrafts(world: DevWorld, gameId: string, drafts: Draft[], now: string, makeId: () => string): { world: DevWorld; added: number; skipped: number } {
  const bugs = [...world.bugs];
  let added = 0;
  for (const d of drafts) {
    if (bugs.length >= MAX_BUGS) break;
    if (bugs.some((b) => b.game === gameId && (norm(b.title) === norm(d.title) || (!!d.ref && b.ref === d.ref)))) continue;
    bugs.push({ id: makeId(), game: gameId, created: now, ...d, ...(d.status === "fixed" && { fixed: now }) });
    added++;
  }
  return { world: { ...world, bugs }, added, skipped: drafts.length - added };
}

const ACTIVE: Status[] = ["open", "fixing"];
const SEV: Severity[] = ["crash", "major", "minor", "polish"];
/** Active first, then priority (unset = medium), severity, oldest first. */
export function sortBacklog(bugs: Bug[]): Bug[] {
  const p = (b: Bug) => PRIORITIES.indexOf(b.priority ?? "medium");
  return [...bugs].sort((a, b) => Number(!ACTIVE.includes(a.status)) - Number(!ACTIVE.includes(b.status)) || p(a) - p(b)
    || SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || a.created.localeCompare(b.created));
}

/** POST /api/goals body for one item. The planner drafts the steps; ORBIT never edits the place, so the why says so. */
export function backlogGoal(game: Pick<Game, "name">, b: Pick<Bug, "title" | "detail" | "kind" | "priority" | "ref">) {
  const kind = b.kind ?? "bug";
  const verb = kind === "bug" ? "Fix" : kind === "feature" ? "Build" : "Polish";
  return {
    title: `${game.name}: ${verb} ${b.title}`.slice(0, 200),
    why: [
      `${kind[0].toUpperCase()}${kind.slice(1)} from the ${game.name} backlog (${b.priority ?? "medium"} priority${b.ref ? `, GitHub ${b.ref}` : ""}).`,
      b.detail ? `Details: ${b.detail.slice(0, 500)}` : "",
      "Steps: find the likely cause or design, draft the Luau change, and write a short test checklist for Studio.",
      "Never change the Roblox place directly: propose code and Andreas applies it in Studio himself.",
    ].filter(Boolean).join(" ").slice(0, 1000),
    metric: { kind: "steps", how: "plan steps done" },
    agents: ["nova", "atlas", "forge"], // CORE's create_goal defaults
  };
}

/** The Luau helper's "error" field for a Fix from this item. */
export const fixContext = (b: Pick<Bug, "title" | "detail">) => `${b.title}${b.detail ? `\n${b.detail}` : ""}`.slice(0, 2000);
