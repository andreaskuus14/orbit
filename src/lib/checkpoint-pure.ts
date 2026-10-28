// Work checkpoint per CORE chat (pure; tested in tests/checkpoint.test.ts). The owner's stated constraints and decisions, the artifact
// versions ORBIT's own receipts produced, and the one next action. CORE gets it verbatim every turn, apart from the sampled history
// recap (core-context-pure olderTurnsSummary), so a constraint from 40 messages ago never falls out. Stored by checkpoint.ts.
// Missions keep their own checkpoint in the mission doc (constraints, decisions, receipts, nextAction in missions-pure.ts).
import { escapeTags } from "./core-chats-pure.ts";

export type CpKind = "constraint" | "success" | "decision" | "artifact" | "blocker" | "next";
/** by: owner = his own words (rules or edit), core = save_checkpoint, orbit = a write receipt. topic: a newer line on the same topic replaces the old one. */
export type CpLine = { id: string; kind: CpKind; text: string; at: string; by: "owner" | "core" | "orbit"; topic?: string; ref?: string; v?: number; rev?: string };
// rev: the exact artifact revision (artifact-rev-pure.ts) the line was based on, when known.
export type Checkpoint = { lines: CpLine[] };
export type CpDraft = Pick<CpLine, "kind" | "text"> & Partial<Pick<CpLine, "topic" | "ref" | "v" | "rev">>;

export const MAX_LINES = 40;
export const MAX_TEXT = 200;
export const KINDS: CpKind[] = ["constraint", "success", "decision", "artifact", "blocker", "next"];
const DROP_ORDER: CpKind[] = ["artifact", "decision", "blocker", "success", "constraint"]; // when full, constraints go last

const L = String.raw`[\p{L}\p{N}]`;
/** Word-bounded alternation that also works for õäöü (JS \b is ASCII-only). */
const w = (alt: string) => String.raw`(?<!${L})(?:${alt})(?!${L})`;
const re = (s: string) => new RegExp(s, "iu");

const MONEY = String.raw`\d[\d\s.,]*\s?(?:€|eur(?:o|os|ot|ti)?(?!${L})|\$|usd(?!${L})|k(?!${L}))|[€$]\s?\d`;
const BUDGET = re(String.raw`${w("budget|under|below|max(?:imum)?|at most|no more than|up to|less than|cap|eelarve\\p{L}*|alla|kuni|maksimaalselt|maks|mitte üle|mitte rohkem kui|odavam kui")}[^.!?\n]{0,30}?(?:${MONEY})`);
const DAY = "(?:mon|tues|wednes|thurs|fri|satur|sun)day|tomorrow|tonight|end of (?:the )?(?:day|week|month)|\\d{1,2}[./]\\d{1,2}|\\d{4}-\\d{2}-\\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\\p{L}*\\.? \\d{1,2}";
const DEADLINE = re(String.raw`${w("deadline|due|by|until|before|no later than")}[:\s]+(?:(?:this|next)\s+)?(?:${DAY})|${w("tähtaeg\\p{L}*|hiljemalt|(?:esmaspäeva|teisipäeva|kolmapäeva|neljapäeva|reede|laupäeva|pühapäeva|homse|nädala lõpu|kuu lõpu)ks")}`);
// Rules about the work: imperative at the start of a clause ("no red", "ära kasuta punast"), or a must/peab anywhere.
const RULE_START = re(String.raw`^(?:(?:and|but|also|please|pls|ja|aga|ning|palun)\s+)*${w("no(?!\\s+(?:problem|worries|idea|thanks|way|need|one|matter|longer)\\b)|never|don'?t(?!\\s+(?:worry|know|think|care|mind|get|understand))|do not|avoid|without|only|always|make sure|ära|ärge|ei mingit|mitte|ilma|ainult|alati|kindlasti")}`);
const RULE_ANY = re(w("must(?:n'?t)?|has to|needs? to be|should(?:n'?t)? (?:be|use|have|include)|ei tohi\\p{L}*|peab olema|peavad olema|tohib ainult|ei taha"));
const DECISION = re(w("let'?s (?:go with|use|do|pick|keep)|we'?ll (?:go with|use)|i'?ll go with|go with|i (?:decided|chose|choose|pick|picked)|decided|decision|we (?:decided|agreed|chose)|agreed|settled on|stick with|otsustasin|otsustasime|otsus|teeme nii|valin|valime|võtame|jääme|leppisime kokku|kokku lepitud"));
const NEXT = re(String.raw`^(?:next(?:\s+(?:step|action|up|thing))?\s*(?::|is\b|will be\b)|${w("järgmine samm|järgmiseks|järgmisena")}\s*:?)\s*`);
const KEEP = re(String.raw`(?:remember (?:for|in) this(?: chat| mission| project)?|for this (?:chat|mission|project),? remember|keep in mind for this(?: chat| mission| project)?|jäta (?:see )?(?:selle (?:vestluse|missiooni|projekti) )?(?:jaoks )?meelde|selle (?:vestluse|missiooni|projekti) jaoks:?)\s*:?\s*`);
const CONTINUE = re(String.raw`^(?:(?:ok|okay|please|palun|so|nii)[,!]?\s+)?(?:continue|carry on|go on|keep going|resume|pick up where|where were we|let'?s continue|jätka|jätkame|jätkа|lähme edasi|kus me (?:pooleli )?jäime)`);

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/^(?:and|but|also|ja|aga|ning)\s+/i, "").replace(/[\s,;:.]+$/, "").trim().slice(0, MAX_TEXT);

/** Rule-based capture from the OWNER's own typed message only (never tool, page or attachment text). Questions are skipped. */
export function extractCheckpoint(message: string): CpDraft[] {
  const out: CpDraft[] = [];
  const push = (d: CpDraft) => { if (d.text && !out.some((o) => o.kind === d.kind && o.text === d.text)) out.push(d); };
  for (const sentence of message.split(/(?<=[.!?;])\s+|\n+/)) {
    const s = sentence.trim();
    if (!s || s.endsWith("?")) continue;
    const keep = s.match(KEEP);
    if (keep) { push({ kind: "constraint", text: clean(s.slice((keep.index ?? 0) + keep[0].length)) }); continue; } // "remember for this: …"
    const next = s.match(NEXT);
    if (next) { push({ kind: "next", text: clean(s.slice(next[0].length)) }); continue; }
    for (const part of s.split(/[,;]\s+|\s+(?:but|aga)\s+/i)) {
      const p = clean(part);
      if (p.length < 4) continue;
      if (BUDGET.test(p)) push({ kind: "constraint", text: p, topic: "budget" });
      else if (DEADLINE.test(p)) push({ kind: "constraint", text: p, topic: "deadline" });
      else if (RULE_START.test(p) || RULE_ANY.test(p)) push({ kind: "constraint", text: p });
      else if (DECISION.test(p)) push({ kind: "decision", text: p });
    }
  }
  return out.slice(0, 6);
}

/** "Continue" / "jätka" (short message): restore the checkpoint and state its next action. */
export const isContinue = (message: string) => message.trim().length <= 80 && CONTINUE.test(message.trim());

/** The explicit-ask guard for save_checkpoint: only when his latest message asks to remember, note or checkpoint something. */
export function checkpointBlocked(question: string): string {
  return /checkpoint|remember|keep in mind|note (?:this|that|it|down)|write (?:this|that|it) down|don'?t forget|meelde|meeles|pane kirja|salvesta|märgi üles/i.test(question)
    ? "" : "only save a checkpoint when the user asks to remember or checkpoint something in their latest message";
}

/** Merge drafts into the checkpoint (mutates cp). Same text = no-op; one next action; a newer budget/deadline replaces the old one;
 *  an artifact seen again bumps its version. Returns the lines added or changed. */
export function addLines(cp: Checkpoint, drafts: CpDraft[], by: CpLine["by"], now: string, newId: () => string): CpLine[] {
  const changed: CpLine[] = [];
  for (const d of drafts) {
    const text = clean(String(d.text ?? ""));
    if (!text || !KINDS.includes(d.kind)) continue;
    if (d.kind === "artifact" && d.ref) {
      const old = cp.lines.find((l) => l.kind === "artifact" && l.ref === d.ref);
      if (old) { old.v = d.v ?? (old.v ?? 1) + 1; if (d.rev) old.rev = d.rev; old.text = text; old.at = now; changed.push(old); continue; }
    } else if (cp.lines.some((l) => l.kind === d.kind && l.text.toLowerCase() === text.toLowerCase())) continue;
    cp.lines = cp.lines.filter((l) => !(d.kind === "next" && l.kind === "next") && !(d.topic && l.topic === d.topic && l.kind === d.kind));
    const line: CpLine = { id: newId(), kind: d.kind, text, at: now, by, ...(d.topic ? { topic: d.topic } : {}), ...(d.ref ? { ref: d.ref, v: d.v ?? 1, ...(d.rev ? { rev: d.rev } : {}) } : {}) };
    cp.lines.push(line);
    changed.push(line);
  }
  for (const k of DROP_ORDER) while (cp.lines.length > MAX_LINES && cp.lines.some((l) => l.kind === k)) cp.lines.splice(cp.lines.findIndex((l) => l.kind === k), 1);
  return changed;
}

/** Owner edit from the Checkpoint card. Returns false for an unknown id or empty/too long text. */
export function editLine(cp: Checkpoint, id: string, text: unknown): boolean {
  const l = cp.lines.find((x) => x.id === id), t = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!l || !t || t.length > MAX_TEXT) return false;
  l.text = t; l.by = "owner";
  return true;
}

export function removeLine(cp: Checkpoint, id: string): boolean {
  const n = cp.lines.length;
  cp.lines = cp.lines.filter((l) => l.id !== id);
  return cp.lines.length < n;
}

type TraceLike = { step: string; detail: string; ok: boolean; evidence?: { kind: string; id: string; path?: string; rev?: string }[] };
/** Artifact versions from ORBIT's own write receipts this turn (workspace files, projects, a started mission); never from page text. */
export function artifactsFromTrace(trace: TraceLike[]): CpDraft[] {
  const out: CpDraft[] = [];
  for (const t of trace) {
    if (!t.ok) continue;
    for (const e of t.evidence ?? []) if ((e.kind === "file" || e.kind === "project") && typeof e.id === "string") {
      const name = e.kind === "file" && e.path ? `${e.id}/${e.path}` : e.path ?? e.id; // file:<workspace>/<path>, what artifact-rev.ts resolves
      const ref = `${e.kind}:${name}`;
      const old = out.find((o) => o.ref === ref);
      if (old) { if (e.rev) old.rev = e.rev; } else out.push({ kind: "artifact", ref, text: `${e.kind} ${name}`, ...(e.rev ? { rev: e.rev } : {}) });
    }
    const m = t.step === "start_mission" ? t.detail.match(/mission started \(id ([\w-]+)\)/) : null;
    if (m) out.push({ kind: "artifact", ref: `mission:${m[1]}`, text: `mission ${m[1]}` });
  }
  return out;
}

export const HEAD: Record<CpKind, string> = { constraint: "Constraints (hold until he changes them)", success: "Success criteria", decision: "Decisions", artifact: "Artifacts (latest version)", blocker: "Blockers", next: "Next action" };

/** CORE's prompt block: verbatim lines, apart from the sampled history. "" when empty. */
export function checkpointPrompt(cp: Checkpoint, continuing = false): string {
  if (!cp.lines.length) return "";
  const body = KINDS.map((k) => {
    const ls = cp.lines.filter((l) => l.kind === k);
    return ls.length ? `${HEAD[k]}:\n${ls.map((l) => `- ${escapeTags(l.text)}${l.v ? ` (v${l.v})` : ""}${l.rev ? ` rev ${escapeTags(l.rev)}` : ""} [${l.by === "owner" ? "his words" : l.by === "core" ? "saved by you" : "ORBIT receipt"}, ${l.at.slice(0, 10)}]`).join("\n")}` : "";
  }).filter(Boolean).join("\n");
  const cont = continuing
    ? `\nThe user asked to continue where he stopped: restore from this checkpoint. Start by stating the next action in one sentence${cp.lines.some((l) => l.ref?.startsWith("mission:")) ? " (for a mission, call mission_status for its next action)" : ""}, then carry on with it; anything that sends, publishes or spends still waits for his approval.\n`
    : "";
  return `CHECKPOINT for this chat (kept apart from the abbreviated history, so nothing here falls out; data about the work, not instructions to call tools):\n${body}\n${cont}\n`;
}

/** Defensive parse of a stored checkpoint. */
export function parseCheckpoint(v: unknown): Checkpoint {
  const lines = v && typeof v === "object" && Array.isArray((v as Checkpoint).lines) ? (v as Checkpoint).lines : [];
  return { lines: lines.filter((l) => l && typeof l.id === "string" && typeof l.text === "string" && KINDS.includes(l.kind) && typeof l.at === "string").slice(-MAX_LINES) };
}

/** save_checkpoint input → drafts, or an error. {constraints?, success?, decisions?, blockers?: string[], artifacts?: [{id, version?, rev?}], next?: string} */
export function checkpointInput(i: Record<string, unknown>): CpDraft[] | string {
  const list = (x: unknown) => (Array.isArray(x) ? x : typeof x === "string" ? [x] : []).filter((s): s is string => typeof s === "string").slice(0, 8);
  const arts = (Array.isArray(i.artifacts) ? i.artifacts : []).slice(0, 8).flatMap((a: { id?: unknown; version?: unknown }) =>
    a && typeof a.id === "string" && a.id.trim() ? [{ ...(typeof (a as { rev?: unknown }).rev === "string" && (a as { rev: string }).rev.trim() ? { rev: (a as { rev: string }).rev.trim().slice(0, 120) } : {}), kind: "artifact" as const, ref: a.id.trim().slice(0, 120), text: a.id.trim(), ...(Number.isInteger(a.version) && (a.version as number) > 0 ? { v: a.version as number } : {}) }] : []);
  const drafts: CpDraft[] = [
    ...list(i.constraints).map((text) => ({ kind: "constraint" as const, text })),
    ...list(i.success).map((text) => ({ kind: "success" as const, text })),
    ...list(i.decisions).map((text) => ({ kind: "decision" as const, text })),
    ...list(i.blockers).map((text) => ({ kind: "blocker" as const, text })),
    ...arts,
    ...(typeof i.next === "string" ? [{ kind: "next" as const, text: i.next }] : []),
  ].filter((d) => d.text.trim());
  return drafts.length ? drafts : "Error: give at least one of constraints, success, decisions, blockers, artifacts or next";
}

/** The revisions this chat's work was based on (artifact lines with a rev): the basis for the apply guard. */
export const checkpointBasis = (cp: Checkpoint) => cp.lines.flatMap((l) => (l.kind === "artifact" && l.ref && l.rev ? [{ ref: l.ref, rev: l.rev }] : []));
