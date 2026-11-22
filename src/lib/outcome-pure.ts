// OUTCOME ENGINE, PR 1: the outcome brief (pure, tested in tests/outcome.test.ts). Plan: docs/OUTCOME-ENGINE-PLAN.md.
// "Tell ORBIT the result you want" becomes a mission draft: one objective, the deliverable, the checks that decide "done", the
// points where it stops for his OK, and 2–4 agent steps. An outcome IS a mission (missions-pure.ts): the draft is a createMission
// body that validateMission accepts. Checks name the existing checker that runs them (nothing here calls a model) and are agreed
// with his one OK; agents can't edit them afterwards. Sending, publishing, uploading and spending are always approval points.
import type { EvidenceKind } from "./mission-checks-pure.ts";

export type OutcomeKind = "roblox" | "shorts" | "shop" | "general";
/** One agreed check. by = the module that runs it; deliverable = runs on the finished work only (the deeper, slower checks). */
export type CheckSpec = { id: string; what: string; by: string; kind: EvidenceKind; deliverable: boolean };
export type OutcomeDraft = {
  kind: OutcomeKind; objective: string; deliverable: string; acceptance: string;
  checks: CheckSpec[]; approvalPoints: string[]; constraints: string[];
  steps: { agent: string; request: string }[];
};

const QUESTION = /\?\s*$|^\s*(how|what|why|when|which|who|did|does|do|is|are|can you tell|kas|mis|miks|kuidas|millal)\b/i;
const VERB = /\b(launch|ship|release|make|build|create|turn|set up|setup|produce|finish|prepare|käivita|tee|ehita|loo|muuda|valmista|avalda)\b/i;

/** Does his message ask for a result (an outcome), not a question or a quick lookup? Only his own latest message counts. */
export function isOutcomeAsk(text: string): boolean {
  const t = text.trim();
  if (t.length < 8 || t.length > 600 || QUESTION.test(t)) return false;
  return (VERB.test(t) && kindOf(t) !== "general") || /^(outcome|result|tulemus)\s*:/i.test(t); // general asks stay ordinary chat unless he says "outcome:"
}

export function kindOf(text: string): OutcomeKind {
  const t = text.toLowerCase();
  if (/\b(shorts?|reels?|tiktoks?|clips?|lühivideo\w*|klipp\w*)\b/.test(t)) return "shorts";
  if (/\b(roblox|place|game update|pet sim\w*|obby|mängu?\w*)\b/.test(t)) return "roblox";
  if (/\b(shop|store|webshop|web shop|e-?pood\w*|pood\w*)\b/.test(t)) return "shop";
  return "general";
}

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, üks: 1, kaks: 2, kolm: 3, neli: 4, viis: 5, kuus: 6, seitse: 7 };
/** How many Shorts: "a week of" → 7, "5 shorts" / "five shorts" → 5, otherwise 3. Capped at 14. */
export function shortsCount(text: string): number {
  const t = text.toLowerCase();
  if (/\b(a |one |üks )?(week|nädal\w*)\b/.test(t)) return 7;
  const m = t.match(/\b(\d{1,2}|[a-zõäöü]+)\s+(shorts?|reels?|clips?|tiktoks?|lühivideo\w*|klipp\w*)\b/);
  const n = m ? (/^\d+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1]] ?? 0) : 0;
  return Math.min(14, n > 0 ? n : 3);
}

const NO_OUTWARD = "Do not send, publish, upload, schedule or spend anything: stop at those points and leave them for the owner's approval.";

const TEMPLATES: Record<OutcomeKind, (text: string) => Omit<OutcomeDraft, "kind" | "objective" | "acceptance" | "constraints">> = {
  shorts: (text) => {
    const n = shortsCount(text);
    return {
      deliverable: `${n} finished vertical Shorts with captions and titles, ready to schedule`,
      checks: [
        { id: "count", what: `${n} rendered clips exist`, by: "clip-store-pure", kind: "artifact", deliverable: true },
        { id: "frames", what: "no black, frozen or blank scenes (frame review)", by: "clips/frame-review-pure", kind: "artifact", deliverable: true },
        { id: "captions", what: "every clip has captions and a title", by: "clip-store-pure", kind: "requirements", deliverable: true },
      ],
      approvalPoints: ["scheduling or publishing the Shorts"],
      steps: [
        { agent: "muse", request: `Pick the ${n} strongest moments for Shorts and write a title and caption plan for each.` },
        { agent: "forge", request: `Make the ${n} Shorts with the STUDIO clip tools from the picked moments, with captions. Save them; do not schedule.` },
        { agent: "qa", request: "Check the finished Shorts against the agreed checks and list any that fail with the reason." },
      ],
    };
  },
  roblox: () => ({
    deliverable: "the update built in Roblox Studio and saved, with a playtest report",
    checks: [
      { id: "scripts", what: "changed scripts compile (Luau check)", by: "luau-pure", kind: "readBack", deliverable: false },
      { id: "playtest", what: "AI playtesters finish with no blocking bug or exploit", by: "playtesters-pure", kind: "outcome", deliverable: true },
      { id: "saved", what: "the place is saved after the change", by: "roblox studio read-back", kind: "readBack", deliverable: true },
    ],
    approvalPoints: ["publishing the place to Roblox", "any Robux or paid asset"],
    steps: [
      { agent: "forge", request: "Plan the update as small changes, then build it in Roblox Studio with the Studio tools. Save the place; do not publish." },
      { agent: "qa", request: "Run the AI playtesters on the saved place and report blocking bugs, exploits and what was changed." },
    ],
  }),
  shop: () => ({
    deliverable: "a working shop site in a workspace, with home, product and checkout or contact pages, ready for review",
    checks: [
      { id: "pages", what: "home, product and checkout or contact pages exist", by: "workspace-pure", kind: "requirements", deliverable: true },
      { id: "static", what: "no broken local links or missing files", by: "workspace-check-pure", kind: "artifact", deliverable: true },
      { id: "render", what: "renders without overflow and with readable contrast", by: "workspace-check", kind: "artifact", deliverable: true },
    ],
    approvalPoints: ["publishing the site", "connecting payments", "sending anything to the client"],
    steps: [
      { agent: "atlas", request: "Research the client's offer and two or three comparable shops; list what the shop must show." },
      { agent: "forge", request: "Build the shop as a site in a new workspace (home, product, checkout or contact). Do not publish or connect payments." },
      { agent: "qa", request: "Check the workspace site against the agreed checks and list anything that fails." },
    ],
  }),
  general: () => ({
    deliverable: "the requested result as a file or workspace, ready for review",
    checks: [{ id: "artifact", what: "the deliverable exists and has no placeholder text", by: "mission-checks-pure checkFile", kind: "artifact", deliverable: true }],
    approvalPoints: ["anything that sends, publishes, uploads or spends"],
    steps: [
      { agent: "nova", request: "Plan the work in small steps and do it with the right tools. Save the result as a file or workspace." },
      { agent: "qa", request: "Check the result against the agreed checks and list anything that fails." },
    ],
  }),
};

/** His message → the draft he confirms with one OK. Pure: same text, same draft. */
export function outcomeDraft(text: string): OutcomeDraft {
  const objective = text.trim().replace(/^(outcome|result|tulemus)\s*:\s*/i, "").replace(/\s+/g, " ").slice(0, 300);
  const kind = kindOf(objective);
  const t = TEMPLATES[kind](objective);
  const acceptance = `${t.deliverable}; done only when: ${t.checks.map((c) => c.what).join("; ")}`.slice(0, 300);
  return { kind, objective, acceptance, constraints: [NO_OUTWARD], ...t };
}

/** The createMission body for a confirmed draft (validateMission still checks it). */
export function toMissionBody(d: OutcomeDraft) {
  return {
    objective: d.objective, acceptance: d.acceptance, constraints: d.constraints,
    brief: { output: d.deliverable.slice(0, 300), evidence: d.checks.map((c) => c.what).join("; ").slice(0, 300), approvalPoints: d.approvalPoints.join("; ").slice(0, 300) },
    steps: d.steps,
  };
}
