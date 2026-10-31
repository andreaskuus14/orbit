// Does the owner's latest message ask CORE to write workspace files? Pure; tests in tests/ws-intent.test.ts. Writes only on the
// owner's own request (an order, a named site/workspace, or a short "yes" to CORE's own pending build offer for that workspace),
// never once page/file/agent output is in context (the caller passes that taint).
import { et, etQuestion, ET_NOT } from "./et-ask-pure.ts";
// Local copy of workspace-pure's slug rule: that module imports node:crypto, and panels.tsx (client) imports this file.
export const slugify = (name: unknown): string | null => {
  if (typeof name !== "string") return null;
  const s = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return s || null;
};

/** CORE's own build offer in this chat, waiting for the owner's yes (set when a ws_write was held back). */
export type WsPending = { workspace: string; at: number };
export type WsGate = { target?: unknown; workspaces?: string[]; pending?: WsPending | null; now?: number };
export const PENDING_MS = 30 * 60_000;

const VERB = /\b(?:build|make|create|write|edit|update|change|fix|save|add|generate|scaffold|code|put|redo|rewrite|tweak|upgrade|improve|polish|redesign|restyle|refactor|continue|finish|apply|implement|extend|enhance|revamp|modernize|modernise)\b/;
const VERB_ET = et("ehita|tee |loo |kirjuta|muuda|paranda|salvesta|lisa|uuenda|genereeri|täienda|kujunda|jätka|rakenda|viimistle|arenda|kaasajasta");
// Bare "it/that/this" doesn't count ("make it so"): the message must name a file, site, page or workspace.
const THING = /\b(?:site|website|web ?page|webpage|page|app|game|files?|html|css|js|javascript|script|landing|portfolio|workspace|folder|index|readme|luau?|python|prototype|demo|design|layout|styles?)\b/;
const THING_ET = et("veebileh|veebisait|leh[te]|lehekülg|äpp|rakendus|mäng|fail|tööruum|kaust|prototüüp|demo|html|skript|kujundus");
// A short go-ahead (whole message): "yes", "yes do it", "go ahead", "build it", "jah", "tee ära", "ehita see".
const YES = /^(?:(?:yes|yeah|yep|yup|sure|ok(?:ay)?|okey|please|pls|go|go ahead|do it|do that|build it|make it|ship it|sounds good|let'?s go|let'?s do it|jah|jaa|jep|olgu|sobib|hea küll|palun|tee ära|tee seda|tee see|ehita see|ehita ära|jätka|mine)[\s,.!]*){1,4}$/iu;

/** Optimal-string-alignment distance (typos and swapped letters: "herath" ↔ "hearth" = 1). */
function osa(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
const GENERIC = /^(?:site|web|page|app|game|demo|test|new|my|the|and|v\d+|\d+)$/;
/** The existing workspace the message names, fuzzily ("upgrade herath and thing" → hearth-rye-v2), or null. */
export function namedWorkspace(question: string, workspaces: string[] = []): string | null {
  const words = (slugify(question) ?? "").split("-").filter((w) => w.length >= 3);
  for (const ws of workspaces) {
    const parts = ws.split("-").filter((p) => p.length >= 3 && !GENERIC.test(p));
    if (parts.some((p) => words.some((w) => osa(w, p) <= (p.length >= 8 ? 2 : p.length >= 4 ? 1 : 0)))) return ws;
  }
  return null;
}

export const isGoAhead = (q: string) => YES.test(q.trim());

/** null = allowed; else the refusal CORE sees. */
export function wsWriteBlocked(question: string, tainted: boolean, gate: WsGate = {}): string | null {
  if (tainted) return "workspace files change only for the user's own request, before any page, file or agent output is in context";
  const q = question.toLowerCase();
  if (/\b(?:don'?t|do not|never|stop|cancel|not now)\b/.test(q) || ET_NOT.test(q)) return "the user said not to; answer instead";
  if (/^\s*(?:how|what|why|which|when|where|explain)\b/.test(q) || etQuestion(q) || /^\s*seleta/.test(q)) return "the user asked a question; answer it instead of writing files";
  const target = typeof gate.target === "string" ? slugify(gate.target) : null;
  const p = gate.pending && (gate.now ?? Date.now()) - gate.pending.at < PENDING_MS ? gate.pending : null;
  if (p && isGoAhead(q)) return !target || target === p.workspace ? null : `the user only confirmed building "${p.workspace}"; write there or ask first`;
  // Operator mode A (AGENTS.md rule 6): building in his own sandboxed, local workspaces needs no extra confirmation; only taint,
  // a "don't" or a plain question stop a write. The model decides whether a message calls for files at all.
  return null;
}

/** The workspace a held-back write offers to build, from that tool call's refusal text (trace detail or step), else null. */
export const wsConfirmOffer = (text: string): string | null => text.match(/confirm build "([a-z0-9-]{1,40})"/)?.[1] ?? null;

/** The owner's own message explicitly asks to build/write files or a site (not a go-ahead, question or "don't"). */
export function explicitBuild(question: string): boolean {
  const q = question.toLowerCase();
  if (/\b(?:don'?t|do not|never|stop|cancel|not now)\b/.test(q) || ET_NOT.test(q) || /^\s*(?:how|what|why|which|when|where|explain)\b/.test(q) || etQuestion(q)) return false;
  return (VERB.test(q) || VERB_ET.test(q)) && (THING.test(q) || THING_ET.test(q));
}
