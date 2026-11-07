// Mission Control v1: the agent team's handoff board (Notion "ORBIT Agent Handoffs", one paragraph per update, appended in
// order) turned into four sections: Done, Working, Blocked, Needs you. Each item: agent, one sentence, proof, a PR/test link.
// Updates for the same agent and PR are grouped and the latest one counts; an update without a PR folds into that agent's
// latest update. Proof tells a passing test, a merged PR and a deployment apart, and ignores negations ("nothing merged").

export type Block = { text: string; links?: string[] };
export type Section = "done" | "working" | "blocked" | "needs";
export const SECTIONS: readonly Section[] = ["done", "working", "blocked", "needs"];
export type Proof = "deployed" | "merged" | "failed" | "passed" | null;
export type TeamItem = {
  agent: string; // "1".."99", or "C" for the Coordinator
  pr: number | null;
  section: Section;
  summary: string; // one short sentence
  next: string; // who acts next, as written ("" when not stated)
  blocker: string; // what blocks it, as written ("" when not stated)
  proof: Proof;
  sha: string; // the commit the update names (head/SHA/at …), first 7 characters, "" when none
  link: { href: string; label: string } | null;
  updates: number; // board updates grouped into this item
};
export type TeamBoard = Record<Section, TeamItem[]>;

// An update starts "Agent N |", "Agent N —" or "Agent N → Agent M"; "Agent 2: …" inside an update addresses an agent.
const SPEAKER = /^\s*(?:Agent\s+(\d{1,2})|(?:ChatGPT\s+)?Coordinator)\s*(?:[|—–→]|-\s|->)/i;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Board blocks → entries. A block that starts with "Agent N" or "Coordinator" starts an entry; others continue the last one. */
export function entries(blocks: Block[]): { agent: string; text: string; links: string[] }[] {
  const out: { agent: string; text: string; links: string[] }[] = [];
  for (const b of blocks) {
    const text = clean(b.text ?? "");
    if (!text) continue;
    const m = SPEAKER.exec(text);
    if (m) out.push({ agent: m[1] ? String(Number(m[1])) : "C", text, links: [...(b.links ?? [])] });
    else if (out.length) { const e = out[out.length - 1]; e.text += ` ${text}`; e.links.push(...(b.links ?? [])); }
  }
  return out;
}

// Phrases that deny a claim ("Nothing merged or deployed", "no deploy", "Blocker: none") don't count as the claim.
const NEGATED = /\b(?:not|nothing|never|no|without|stays?|until|before(?: any)?)\b[^.;|]{0,40}?\b(?:merged?|merging|deploy\w*|live (?:release|install|deploy\w*))\b(?:\s*(?:,|\bor\b|\band\b|\bnor\b)\s*(?:merged|deploy\w*))*/gi;
const NOTHING = String.raw`(?:none|no(?:thing)?)\s*(?:$|[.;,)|]|blockers?\b)`; // "none", a bare "no" ("no GitHub API" IS a blocker)
const NO_BLOCKER = new RegExp(String.raw`\b(?:blocked|blockers?)\s*:\s*${NOTHING}[^.;|]*`, "gi");
// "if the gate passes, #431 can be merged and deployed", "waiting for merge", "ready to deploy" aren't claims either.
const CONDITIONAL = /\b(?:if|once|after|when|can|could|will|would|should|may|ready to|waiting for|to be|needs? to)\b[^.;|]{0,60}?\b(?:merged?|merging|deploy\w*)\b(?:\s*(?:,|\bor\b|\band\b)\s*(?:merged|deploy\w*))*/gi;
const positive = (t: string) => t.replace(NEGATED, " ").replace(CONDITIONAL, " ").replace(NO_BLOCKER, " ");

/** The "next:" clause, as written (pipe format "| next: …" or sentence "Next: …"). */
export function nextOf(text: string): string {
  const m = /\bnext(?: step)?\s*:\s*([^|]+)/i.exec(text);
  return m ? clean(m[1]).split(/(?<=[a-z0-9)\]])\.\s+(?=[A-Z])/)[0].replace(/[.;]\s*$/, "").slice(0, 160) : "";
}

/** What blocks it, as written ("Blocked: …" / "Blocker: …"), "" when nothing is stated. */
export function blockerOf(text: string): string {
  const m = /\b(?:blocked|blockers?)\s*:\s*([^|]+)/i.exec(text);
  if (!m || new RegExp(String.raw`^\s*${NOTHING}`, "i").test(m[1])) return "";
  return clean(m[1]).split(/(?<=[a-z0-9)\]])\.\s+(?=[A-Z])/)[0].replace(/[.;]\s*$/, "").slice(0, 160);
}

const NEEDS = /\bAndreas(?:\/owner|\/Coordinator)?\s+(?:decides?|decision|approv\w*|review\w*|merge decision)|\bAndreas,\s*(?:merge|approve|decide|review)|\b(?:owner|Andreas)(?:'s)?\s+(?:merge\s+)?(?:decision|approval|review)\b|\bneeds?\s+(?:your|Andreas'?s?|the owner'?s?)\b/i;
const BLOCKED = (t: string) => /\bBLOCKED\b|\bFAIL(?:S|ED)?\b/.test(t) || /\b(?:blocked|blockers?)\s*:|\bblocked on\b/i.test(t);
const WORKING = /\bclaiming\b|\bIN PROGRESS\b|\bin progress, no result\b|\bnow starting\b|\breproducing\b|\bis running\b|\bgate (?:and drills )?(?:are|is) running\b/i;
const DONE = /\bshipped\b|\bverified\b|\bfinished\b|\bPASS(?:ED)?\b|\bdone\b|\bmerged\b|\bready for review\b/i;

/** Which section one update belongs in: the owner's decision first, then a blocker, then work in progress, then done. */
export function sectionOf(text: string): Section {
  const t = positive(text), next = nextOf(text);
  if (next ? /^\W*(?:Andreas|owner)\b/i.test(next) || NEEDS.test(next) : NEEDS.test(t)) return "needs";
  if (BLOCKED(t)) return "blocked";
  if (DONE.test(positive(summaryOf(text)))) return "done"; // the update's own headline ("shipped: …") beats other work it mentions
  if (WORKING.test(t)) return "working";
  return DONE.test(t) ? "done" : "working";
}

/** Strongest proof stated: a deployment > a merged PR > a failing test > a passing test. */
export function proofOf(text: string): Proof {
  const t = positive(text);
  // only a statement of what happened: "deployed <sha>/to …", "merged #N", "#N merged", "Merged … → <sha>", "in main <sha>"
  if (/\bdeployed\s+(?:[0-9a-f]{7}|to|on|at)\b|\blive (?:release|install) (?:done|complete)/i.test(t)) return "deployed";
  if (/\bmerged\s+(?:#\d+|in(?:to)? main|by|as)\b|#\d+\s+(?:\([^)]*\)\s+)?(?:is\s+|was\s+)?merged\b|\bmerged\b[^.;|]{0,40}?(?:→|->)\s*[0-9a-f]{7}|\bin main [0-9a-f]{7}\b|\blanded in main\b/i.test(t)) return "merged";
  if (/\bFAIL(?:S|ED)?\b|\b[1-9]\d* fail\b/.test(t)) return "failed";
  if (/\bPASS(?:ED)?\b|\bpass(?:es|ed)\b|\d+ pass \/ 0 fail|\d+\/0\b|\d+ ok \/ 0 failed/i.test(t)) return "passed";
  return null;
}

/** The PR this update is about: the first "#NNN" (a PR number, not a run number). */
export function prOf(text: string): number | null {
  const first = (t: string) => { const m = /(?:^|[^\w/])#(\d{2,5})\b/.exec(t); return m ? Number(m[1]) : null; };
  if (!text.includes("|")) return first(text);
  // pipe format: the PR field ("PR #431 head …", "#427 (draft)"), else the first field; not a side note further on ("| #427: …")
  const fields = text.split("|").slice(1);
  const prField = fields.find((f) => /^\s*(?:draft\s+)?PR\b/i.test(f) || /^\s*#\d+\s*(?:\([^)]*\))?\s*$/.test(f));
  return first(prField ?? fields[0] ?? "");
}

/** The commit an update names ("head 4ac80cc…", "SHA …", "at faf06df", "in main 02b6c8f"), first 7 characters. */
export function shaOf(text: string): string {
  const m = /\b(?:head|SHA|at|on|main|commit)\s*:?\s*`?([0-9a-f]{7,40})\b/i.exec(text);
  return m ? m[1].slice(0, 7) : "";
}

/** One short sentence: the pipe format's second field, else the first sentence after the speaker. */
export function summaryOf(text: string): string {
  let s = text.replace(SPEAKER, "").replace(/^\s*(?:→?\s*Agent\s+\d+\s*[—–\-|:])?\s*/, "");
  if (text.includes("|")) { // the first field that says something: not "#427 (draft)", "next: …", "PR …", "no file claims"
    const fields = text.split("|").slice(1);
    s = fields.find((f) => !/^\s*(?:next|PR(?:\/SHA)?|SHA|branch|(?:no )?file claims?|blockers?|blocked)\b/i.test(f) && f.replace(/#\d+|\([^)]*\)/g, " ").trim().split(/\s+/).filter(Boolean).length >= 2) ?? fields[0] ?? s;
  }
  s = s.replace(/^\s*(?:Task|Status(?:\s*\([^)]*\))?|Update(?:\s+[\d:]+\s*UTC)?)\s*:\s*/i, "");
  s = clean(s).split(/(?<=[a-z0-9)\]])\.\s+(?=[A-Z])/)[0].replace(/[.:;]\s*$/, "");
  return s.length > 140 ? `${s.slice(0, 137).replace(/\s+\S*$/, "")}…` : s;
}

/** A PR link (the one for this item's PR first), else a test-run link, else one built from the repo name. */
export function linkOf(links: string[], pr: number | null, repo = ""): TeamItem["link"] {
  const pulls = links.filter((l) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(l));
  const mine = pulls.find((l) => pr !== null && new RegExp(`/pull/${pr}(?:\\D|$)`).test(l)) ?? (pr === null ? pulls[0] : undefined);
  if (mine) return { href: mine, label: `#${/\/pull\/(\d+)/.exec(mine)![1]}` };
  if (pr !== null && /^[\w.-]+\/[\w.-]+$/.test(repo)) return { href: `https://github.com/${repo}/pull/${pr}`, label: `#${pr}` };
  const run = links.find((l) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+/.test(l));
  return run ? { href: run, label: "test run" } : null;
}

/** The board: one item per agent and PR (latest update wins), sorted newest first within each section. */
export function teamBoard(blocks: Block[], repo = ""): TeamBoard {
  const es = entries(blocks).map((e, i) => ({ ...e, i, pr: prOf(e.text) }));
  const groups = new Map<string, typeof es>();
  for (const e of es) { const key = `${e.agent}:${e.pr ?? "-"}`; groups.set(key, [...(groups.get(key) ?? []), e]); }
  const board: TeamBoard = { done: [], working: [], blocked: [], needs: [] };
  const items = [...groups.values()].map((g) => {
    const last = g[g.length - 1];
    const links = g.flatMap((e) => e.links).reverse(); // newest links first
    // a later update with no result of its own ("check is running") doesn't hide an earlier FAIL in the same group
    const proof = proofOf(last.text) ?? (g.some((e) => proofOf(e.text) === "failed") ? "failed" : null);
    return { i: last.i, item: { agent: last.agent, pr: last.pr, section: sectionOf(last.text), summary: summaryOf(last.text),
      next: nextOf(last.text), blocker: blockerOf(last.text), proof, sha: shaOf(last.text), link: linkOf(links, last.pr, repo), updates: g.length } satisfies TeamItem };
  }).sort((a, b) => b.i - a.i);
  for (const { item } of items) board[item.section].push(item);
  // Done: merged/deployed work first, then work that's done but not merged
  const landed = (i: TeamItem) => (i.proof === "merged" || i.proof === "deployed" ? 0 : 1);
  board.done.sort((a, b) => landed(a) - landed(b));
  return board;
}

export const agentLabel = (agent: string) => (agent === "C" ? "Coordinator" : `Agent ${agent}`);
